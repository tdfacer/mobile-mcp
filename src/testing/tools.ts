import { z } from "zod";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

import { Robot } from "../robot";
import { SqliteStore } from "./sqlite-store";
import { SessionManager } from "./session";
import { MonkeyRunner } from "./monkey/runner";
import { AndroidCrashDetector } from "./monkey/crash-detector";
import { RecordingRobot } from "./recording-robot";
import { ScriptBuilder } from "./script-builder";
import { ScriptExecutor } from "./procedural/executor";

type ZodSchemaShape = Record<string, z.ZodType>;

interface ToolAnnotations {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
}

type ToolFn = (
	name: string,
	title: string,
	description: string,
	paramsSchema: ZodSchemaShape,
	annotations: ToolAnnotations,
	cb: (args: any) => Promise<string>,
) => void;

export function registerTestingTools(deps: {
	tool: ToolFn;
	getRobotFromDevice: (deviceId: string) => Robot;
	robotOverrides: Map<string, Robot>;
}): void {
	const { tool, getRobotFromDevice, robotOverrides } = deps;

	const dbPath = path.join(os.homedir(), ".mobile-mcp", "testing.db");
	const store = new SqliteStore(dbPath);
	const sessionManager = new SessionManager(store);
	const monkeyRunner = new MonkeyRunner(store, sessionManager);
	const scriptBuilder = new ScriptBuilder(store);
	const scriptExecutor = new ScriptExecutor(store, sessionManager);

	// -----------------------------------------------------------------------
	// Monkey testing tools
	// -----------------------------------------------------------------------

	tool(
		"mobile_monkey_start",
		"Start Monkey Test",
		"Start a monkey test that performs random actions on the device to find crashes and errors. The test runs in the background. Use mobile_monkey_status to check progress and mobile_monkey_stop to stop it.",
		{
			device: z.string().describe("The device identifier to use"),
			appPackage: z.string().optional().describe("Package name of the app to test. If provided, the app will be relaunched after crashes."),
			maxActions: z.coerce.number().optional().describe("Maximum number of random actions to perform"),
			maxDurationMs: z.coerce.number().optional().describe("Maximum duration in milliseconds"),
			seed: z.coerce.number().optional().describe("Random seed for reproducible test runs"),
		},
		{ destructiveHint: true },
		async ({ device, appPackage, maxActions, maxDurationMs, seed }) => {
			const robot = getRobotFromDevice(device);
			const crashDetector = new AndroidCrashDetector(device);
			const state = await monkeyRunner.start({
				deviceId: device,
				platform: "android",
				robot,
				appPackage,
				config: { maxActions, maxDurationMs, seed },
				crashDetector,
			});
			return JSON.stringify({
				reportId: state.reportId,
				sessionId: state.sessionId,
				status: "running",
			});
		}
	);

	tool(
		"mobile_monkey_status",
		"Monkey Test Status",
		"Check the current status of a running monkey test",
		{
			device: z.string().describe("The device identifier"),
		},
		{ readOnlyHint: true },
		async ({ device }) => {
			const state = monkeyRunner.getStatus(device);
			if (!state) {
				return JSON.stringify({ status: "not_running" });
			}
			const report = monkeyRunner.getReport(state.reportId);
			return JSON.stringify({
				reportId: state.reportId,
				sessionId: state.sessionId,
				running: state.running,
				stopping: state.stopping,
				stepsExecuted: report?.stepsExecuted ?? 0,
				stepsPassed: report?.stepsPassed ?? 0,
				stepsFailed: report?.stepsFailed ?? 0,
			});
		}
	);

	tool(
		"mobile_monkey_stop",
		"Stop Monkey Test",
		"Stop a running monkey test and get the final report",
		{
			device: z.string().describe("The device identifier"),
		},
		{ destructiveHint: true },
		async ({ device }) => {
			const report = monkeyRunner.stop(device);
			if (!report) {
				return JSON.stringify({ error: "No monkey test running on this device" });
			}
			return JSON.stringify(report);
		}
	);

	tool(
		"mobile_monkey_report",
		"Get Monkey Test Report",
		"Get the full report for a monkey test run, including all errors and details",
		{
			reportId: z.string().describe("The report ID returned by mobile_monkey_start"),
		},
		{ readOnlyHint: true },
		async ({ reportId }) => {
			const report = monkeyRunner.getReport(reportId);
			if (!report) {
				return JSON.stringify({ error: "Report not found" });
			}
			return JSON.stringify(report);
		}
	);

	// -----------------------------------------------------------------------
	// Recording / data collection tools
	// -----------------------------------------------------------------------

	// Track recording sessions: deviceId -> { sessionId, originalRobot }
	const activeRecordingSessions = new Map<string, { sessionId: string }>();

	tool(
		"mobile_recording_start",
		"Start Recording",
		"Start recording device interactions. While recording is active, all actions performed via mobile_* tools on this device will be captured. Use mobile_recording_stop to finish and mobile_recording_build_script to save as a replayable script.",
		{
			device: z.string().describe("The device identifier to use"),
			taskDescription: z.string().optional().describe("Description of the task being recorded (e.g. 'login and go to settings')"),
			appPackage: z.string().optional().describe("Package name of the app being tested"),
		},
		{ destructiveHint: true },
		async ({ device, taskDescription, appPackage }) => {
			if (activeRecordingSessions.has(device)) {
				return JSON.stringify({ error: "Recording already active on this device. Stop it first." });
			}

			const robot = getRobotFromDevice(device);
			const session = await sessionManager.startSession({
				mode: "recording",
				deviceId: device,
				platform: "android",
				robot,
				appPackage,
			});

			const recordingRobot = new RecordingRobot(robot, session.id, store);
			robotOverrides.set(device, recordingRobot);
			activeRecordingSessions.set(device, { sessionId: session.id });

			return JSON.stringify({
				sessionId: session.id,
				status: "recording",
				taskDescription: taskDescription ?? "",
			});
		}
	);

	tool(
		"mobile_recording_stop",
		"Stop Recording",
		"Stop recording device interactions. Returns a summary of what was captured.",
		{
			device: z.string().describe("The device identifier"),
		},
		{ destructiveHint: true },
		async ({ device }) => {
			const recording = activeRecordingSessions.get(device);
			if (!recording) {
				return JSON.stringify({ error: "No active recording on this device" });
			}

			robotOverrides.delete(device);
			activeRecordingSessions.delete(device);

			const session = sessionManager.endSession(recording.sessionId);
			const actions = store.getActionsForSession(recording.sessionId);

			return JSON.stringify({
				sessionId: recording.sessionId,
				actionCount: actions.length,
				durationMs: session.endedAt ? session.endedAt - session.startedAt : 0,
			});
		}
	);

	tool(
		"mobile_recording_build_script",
		"Build Script from Recording",
		"Convert a recording session into a replayable test script",
		{
			sessionId: z.string().describe("The session ID from mobile_recording_start"),
			name: z.string().describe("Name for the test script"),
			description: z.string().optional().describe("Description of what the script does"),
			tags: z.string().optional().describe("Comma-separated tags for the script"),
		},
		{ destructiveHint: true },
		async ({ sessionId, name, description, tags }) => {
			const session = sessionManager.getSession(sessionId);
			if (!session) {
				return JSON.stringify({ error: `Session "${sessionId}" not found` });
			}

			const script = scriptBuilder.buildFromSession({
				sessionId,
				name,
				description,
				platform: session.platform,
				appPackage: session.appPackage,
				tags: tags ? tags.split(",").map((t: string) => t.trim()) : [],
				screenSize: session.screenSize,
			});

			const steps = store.getStepsForScript(script.id);

			return JSON.stringify({
				scriptId: script.id,
				name: script.name,
				stepCount: steps.length,
			});
		}
	);

	tool(
		"mobile_script_list",
		"List Test Scripts",
		"List all saved test scripts",
		{},
		{ readOnlyHint: true },
		async () => {
			const scripts = store.listScripts();
			return JSON.stringify({ scripts: scripts.map(s => ({
				id: s.id,
				name: s.name,
				description: s.description,
				platform: s.platform,
				appPackage: s.appPackage,
				tags: s.tags,
				createdAt: s.createdAt,
			})) });
		}
	);

	tool(
		"mobile_script_get",
		"Get Test Script",
		"Get a test script with all its steps",
		{
			scriptId: z.string().describe("The script ID"),
		},
		{ readOnlyHint: true },
		async ({ scriptId }) => {
			const script = store.getScript(scriptId);
			if (!script) {
				return JSON.stringify({ error: `Script "${scriptId}" not found` });
			}
			const steps = store.getStepsForScript(scriptId);
			return JSON.stringify({ script, steps });
		}
	);

	tool(
		"mobile_script_delete",
		"Delete Test Script",
		"Delete a saved test script and all its steps",
		{
			scriptId: z.string().describe("The script ID to delete"),
		},
		{ destructiveHint: true },
		async ({ scriptId }) => {
			store.deleteScript(scriptId);
			return JSON.stringify({ deleted: scriptId });
		}
	);

	tool(
		"mobile_script_export",
		"Export Test Script",
		"Export a test script as a portable JSON blob",
		{
			scriptId: z.string().describe("The script ID to export"),
		},
		{ readOnlyHint: true },
		async ({ scriptId }) => {
			const script = store.getScript(scriptId);
			if (!script) {
				return JSON.stringify({ error: `Script "${scriptId}" not found` });
			}
			const steps = store.getStepsForScript(scriptId);
			return JSON.stringify({ version: 1, script, steps });
		}
	);

	tool(
		"mobile_script_import",
		"Import Test Script",
		"Import a test script from a JSON blob (as produced by mobile_script_export). Creates a new script with a new ID, preserving all steps and assertions.",
		{
			json: z.string().describe("The JSON string from mobile_script_export"),
		},
		{ destructiveHint: true },
		async ({ json }) => {
			let data: any;
			try {
				data = JSON.parse(json);
			} catch {
				return JSON.stringify({ error: "Invalid JSON" });
			}

			if (!data.script || !Array.isArray(data.steps)) {
				return JSON.stringify({ error: "Invalid format: expected { script, steps } from mobile_script_export" });
			}

			const newScriptId = crypto.randomUUID();
			const now = Date.now();
			const script = {
				...data.script,
				id: newScriptId,
				createdAt: now,
				updatedAt: now,
			};
			store.createScript(script);

			for (const step of data.steps) {
				store.createStep({
					...step,
					id: crypto.randomUUID(),
					scriptId: newScriptId,
				});
			}

			const steps = store.getStepsForScript(newScriptId);
			return JSON.stringify({
				scriptId: newScriptId,
				name: script.name,
				stepCount: steps.length,
			});
		}
	);

	// -----------------------------------------------------------------------
	// Procedural testing tools
	// -----------------------------------------------------------------------

	tool(
		"mobile_test_run_script",
		"Run Test Script",
		"Execute a saved test script against a device. Steps run sequentially, verifying assertions after each action. Returns a report ID to check results.",
		{
			device: z.string().describe("The device identifier to use"),
			scriptId: z.string().describe("ID of the test script to run"),
		},
		{ destructiveHint: true },
		async ({ device, scriptId }) => {
			const robot = getRobotFromDevice(device);
			const script = store.getScript(scriptId);
			if (!script) {
				return JSON.stringify({ error: `Script "${scriptId}" not found` });
			}
			const steps = store.getStepsForScript(scriptId);
			if (steps.length === 0) {
				return JSON.stringify({ error: `Script "${scriptId}" has no steps` });
			}
			const crashDetector = new AndroidCrashDetector(device);
			const reportId = await scriptExecutor.execute({
				script, steps, deviceId: device, robot, crashDetector,
			});
			return JSON.stringify({ reportId, status: "running", stepCount: steps.length });
		}
	);

	tool(
		"mobile_test_run_status",
		"Test Run Status",
		"Check the current status of a running test script execution",
		{
			device: z.string().describe("The device identifier"),
		},
		{ readOnlyHint: true },
		async ({ device }) => {
			const status = scriptExecutor.getStatus(device);
			if (!status) {
				return JSON.stringify({ status: "not_running" });
			}
			const report = store.getReport(status.reportId);
			return JSON.stringify({
				reportId: status.reportId,
				running: status.running,
				currentStep: status.currentStep,
				stepsExecuted: report?.stepsExecuted ?? 0,
				stepsPassed: report?.stepsPassed ?? 0,
				stepsFailed: report?.stepsFailed ?? 0,
			});
		}
	);

	tool(
		"mobile_test_stop_script",
		"Stop Test Script",
		"Stop a running test script execution",
		{
			device: z.string().describe("The device identifier"),
		},
		{ destructiveHint: true },
		async ({ device }) => {
			scriptExecutor.stop(device);
			const status = scriptExecutor.getStatus(device);
			if (!status) {
				return JSON.stringify({ error: "No test running on this device" });
			}
			return JSON.stringify({ reportId: status.reportId, stopping: true });
		}
	);

	tool(
		"mobile_test_get_report",
		"Get Test Report",
		"Get the full report for a test run, including per-step results and error details",
		{
			reportId: z.string().describe("The report ID"),
		},
		{ readOnlyHint: true },
		async ({ reportId }) => {
			const report = store.getReport(reportId);
			if (!report) {
				return JSON.stringify({ error: `Report "${reportId}" not found` });
			}
			return JSON.stringify(report);
		}
	);

	tool(
		"mobile_test_list_reports",
		"List Test Reports",
		"List all test reports, most recent first",
		{
			limit: z.coerce.number().optional().describe("Maximum number of reports to return"),
		},
		{ readOnlyHint: true },
		async ({ limit }) => {
			const reports = store.listReports(limit);
			return JSON.stringify({ reports });
		}
	);

	tool(
		"mobile_test_add_assertion",
		"Add Test Assertion",
		"Add an assertion to a test script step. Assertions verify screen state after the step executes.",
		{
			scriptId: z.string().describe("The script ID"),
			stepSequence: z.coerce.number().describe("The step sequence number (1-based) to add the assertion to"),
			assertionType: z.enum(["elementExists", "elementHasText", "screenContainsText", "noErrorDialog"]).describe("Type of assertion"),
			params: z.string().describe("JSON-encoded assertion parameters (e.g. '{\"identifier\": \"login_btn\"}' for elementExists, '{\"text\": \"Welcome\"}' for screenContainsText)"),
			soft: z.boolean().optional().describe("If true, assertion failure logs a warning but doesn't stop execution. Default: false"),
		},
		{ destructiveHint: true },
		async ({ scriptId, stepSequence, assertionType, params, soft }) => {
			const script = store.getScript(scriptId);
			if (!script) {
				return JSON.stringify({ error: `Script "${scriptId}" not found` });
			}

			const steps = store.getStepsForScript(scriptId);
			const step = steps.find(s => s.sequenceNumber === stepSequence);
			if (!step) {
				return JSON.stringify({ error: `Step ${stepSequence} not found in script "${scriptId}"` });
			}

			let parsedParams: Record<string, string>;
			try {
				parsedParams = JSON.parse(params);
			} catch {
				return JSON.stringify({ error: "Invalid JSON in params" });
			}

			step.assertions.push({
				type: assertionType,
				params: parsedParams,
				soft: soft ?? false,
			});

			// Re-save the step (delete and recreate since we don't have an updateStep)
			store.deleteStepsForScript(scriptId);
			for (const s of steps) {
				store.createStep(s);
			}

			return JSON.stringify({
				scriptId,
				stepSequence,
				assertionCount: step.assertions.length,
			});
		}
	);

	tool(
		"mobile_test_set_step_delay",
		"Set Step Delay",
		"Set the delay (in milliseconds) that occurs after a test script step executes, before the next step begins. This gives the UI time to settle after actions like taps or navigation. Steps have automatic defaults based on action type (e.g. 1000ms after tap, 2000ms after launchApp), but you can override them here.",
		{
			scriptId: z.string().describe("The script ID"),
			stepSequence: z.coerce.number().describe("The step sequence number (1-based) to set the delay on. Use 0 to set the delay on all steps."),
			delayMs: z.coerce.number().describe("Delay in milliseconds after the step executes (0 to disable delay)"),
		},
		{ destructiveHint: true },
		async ({ scriptId, stepSequence, delayMs }) => {
			const script = store.getScript(scriptId);
			if (!script) {
				return JSON.stringify({ error: `Script "${scriptId}" not found` });
			}

			const steps = store.getStepsForScript(scriptId);

			if (stepSequence === 0) {
				// Apply to all steps
				for (const s of steps) {
					s.delayAfterMs = delayMs;
				}
			} else {
				const step = steps.find(s => s.sequenceNumber === stepSequence);
				if (!step) {
					return JSON.stringify({ error: `Step ${stepSequence} not found in script "${scriptId}"` });
				}
				step.delayAfterMs = delayMs;
			}

			store.deleteStepsForScript(scriptId);
			for (const s of steps) {
				store.createStep(s);
			}

			return JSON.stringify({
				scriptId,
				stepSequence: stepSequence === 0 ? "all" : stepSequence,
				delayMs,
				stepsUpdated: stepSequence === 0 ? steps.length : 1,
			});
		}
	);

	// -----------------------------------------------------------------------
	// Script step editing tools
	// -----------------------------------------------------------------------

	tool(
		"mobile_script_delete_step",
		"Delete Script Step",
		"Delete a step from a test script. Remaining steps are renumbered automatically.",
		{
			scriptId: z.string().describe("The script ID"),
			stepSequence: z.coerce.number().describe("The step sequence number (1-based) to delete"),
		},
		{ destructiveHint: true },
		async ({ scriptId, stepSequence }) => {
			const script = store.getScript(scriptId);
			if (!script) {
				return JSON.stringify({ error: `Script "${scriptId}" not found` });
			}

			const steps = store.getStepsForScript(scriptId);
			const idx = steps.findIndex(s => s.sequenceNumber === stepSequence);
			if (idx === -1) {
				return JSON.stringify({ error: `Step ${stepSequence} not found in script "${scriptId}"` });
			}

			steps.splice(idx, 1);
			// Renumber
			for (let i = 0; i < steps.length; i++) {
				steps[i].sequenceNumber = i + 1;
			}

			store.deleteStepsForScript(scriptId);
			for (const s of steps) {
				store.createStep(s);
			}

			return JSON.stringify({ scriptId, deletedStep: stepSequence, remainingSteps: steps.length });
		}
	);

	tool(
		"mobile_script_move_step",
		"Move Script Step",
		"Move a step to a new position in the script. Other steps are renumbered automatically.",
		{
			scriptId: z.string().describe("The script ID"),
			fromSequence: z.coerce.number().describe("The current step sequence number (1-based)"),
			toSequence: z.coerce.number().describe("The target position (1-based)"),
		},
		{ destructiveHint: true },
		async ({ scriptId, fromSequence, toSequence }) => {
			const script = store.getScript(scriptId);
			if (!script) {
				return JSON.stringify({ error: `Script "${scriptId}" not found` });
			}

			const steps = store.getStepsForScript(scriptId);
			const fromIdx = steps.findIndex(s => s.sequenceNumber === fromSequence);
			if (fromIdx === -1) {
				return JSON.stringify({ error: `Step ${fromSequence} not found in script "${scriptId}"` });
			}
			if (toSequence < 1 || toSequence > steps.length) {
				return JSON.stringify({ error: `Target position ${toSequence} is out of range (1-${steps.length})` });
			}

			const [step] = steps.splice(fromIdx, 1);
			steps.splice(toSequence - 1, 0, step);

			for (let i = 0; i < steps.length; i++) {
				steps[i].sequenceNumber = i + 1;
			}

			store.deleteStepsForScript(scriptId);
			for (const s of steps) {
				store.createStep(s);
			}

			return JSON.stringify({ scriptId, movedStep: fromSequence, newPosition: toSequence, totalSteps: steps.length });
		}
	);

	tool(
		"mobile_script_update_step",
		"Update Script Step",
		"Update the parameters of a script step (e.g. change tap coordinates, text input, or timeout).",
		{
			scriptId: z.string().describe("The script ID"),
			stepSequence: z.coerce.number().describe("The step sequence number (1-based) to update"),
			params: z.string().optional().describe("JSON-encoded new action parameters to merge (e.g. '{\"x\": 200, \"y\": 500}')"),
			timeoutMs: z.coerce.number().optional().describe("New timeout in milliseconds"),
			delayAfterMs: z.coerce.number().optional().describe("New delay after step in milliseconds"),
		},
		{ destructiveHint: true },
		async ({ scriptId, stepSequence, params, timeoutMs, delayAfterMs }) => {
			const script = store.getScript(scriptId);
			if (!script) {
				return JSON.stringify({ error: `Script "${scriptId}" not found` });
			}

			const steps = store.getStepsForScript(scriptId);
			const step = steps.find(s => s.sequenceNumber === stepSequence);
			if (!step) {
				return JSON.stringify({ error: `Step ${stepSequence} not found in script "${scriptId}"` });
			}

			if (params !== undefined) {
				let parsedParams: Record<string, unknown>;
				try {
					parsedParams = JSON.parse(params);
				} catch {
					return JSON.stringify({ error: "Invalid JSON in params" });
				}
				step.params = { ...step.params, ...parsedParams } as any;
			}
			if (timeoutMs !== undefined) {
				step.timeoutMs = timeoutMs;
			}
			if (delayAfterMs !== undefined) {
				step.delayAfterMs = delayAfterMs;
			}

			store.deleteStepsForScript(scriptId);
			for (const s of steps) {
				store.createStep(s);
			}

			return JSON.stringify({ scriptId, stepSequence, updated: true });
		}
	);

	tool(
		"mobile_test_add_wait",
		"Add Wait-for-Element",
		"Add a wait-for-element condition to a script step. Before the step executes, the executor will poll until the specified element appears on screen (up to the step's timeoutMs). This replaces fixed delays with dynamic waiting for screens to load.",
		{
			scriptId: z.string().describe("The script ID"),
			stepSequence: z.coerce.number().describe("The step sequence number (1-based) to add the wait to"),
			identifier: z.string().optional().describe("Wait for element with this accessibility identifier (resource-id on Android)"),
			text: z.string().optional().describe("Wait for element containing this text"),
			type: z.string().optional().describe("Element type to match (e.g. 'Button', 'TextField'). Combines with text or label for more precise matching."),
			label: z.string().optional().describe("Wait for element with this accessibility label (content-desc on Android)"),
			timeoutMs: z.coerce.number().optional().describe("Override the step's timeout for waiting (default: use existing step timeoutMs)"),
		},
		{ destructiveHint: true },
		async ({ scriptId, stepSequence, identifier, text, type: elemType, label, timeoutMs }) => {
			const script = store.getScript(scriptId);
			if (!script) {
				return JSON.stringify({ error: `Script "${scriptId}" not found` });
			}

			const steps = store.getStepsForScript(scriptId);
			const step = steps.find(s => s.sequenceNumber === stepSequence);
			if (!step) {
				return JSON.stringify({ error: `Step ${stepSequence} not found in script "${scriptId}"` });
			}

			if (!identifier && !text && !label) {
				return JSON.stringify({ error: "At least one of identifier, text, or label is required" });
			}

			const matcher: any = {};
			if (identifier) {matcher.identifier = identifier;}
			if (text) {matcher.text = text;}
			if (elemType) {matcher.type = elemType;}
			if (label) {matcher.label = label;}

			step.waitForElement = matcher;
			if (timeoutMs !== undefined) {
				step.timeoutMs = timeoutMs;
			}

			store.deleteStepsForScript(scriptId);
			for (const s of steps) {
				store.createStep(s);
			}

			return JSON.stringify({ scriptId, stepSequence, waitForElement: matcher });
		}
	);
}
