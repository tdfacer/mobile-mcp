import crypto from "node:crypto";

import {
	TestScript, TestScriptStep, TestReport,
	TapParams, DoubleTapParams, LongPressParams, SwipeParams,
	SendKeysParams, PressButtonParams, LaunchAppParams,
	TerminateAppParams, OpenUrlParams, SetOrientationParams,
} from "../schemas";
import { Robot, Button } from "../../robot";
import { TestStore } from "../store";
import { SessionManager } from "../session";
import { evaluateAssertions } from "./assertions";
import { findElement } from "./element-matcher";

interface RunState {
	running: boolean;
	stopping: boolean;
	reportId: string;
	sessionId: string;
	currentStep: number;
}

export class ScriptExecutor {
	private activeRuns = new Map<string, RunState>();

	constructor(
		private store: TestStore,
		private sessionManager: SessionManager,
	) {}

	async execute(opts: {
		script: TestScript;
		steps: TestScriptStep[];
		deviceId: string;
		robot: Robot;
	}): Promise<string> {
		const existing = this.activeRuns.get(opts.deviceId);
		if (existing?.running) {
			throw new Error(`Script already running on device "${opts.deviceId}"`);
		}

		const session = await this.sessionManager.startSession({
			mode: "procedural",
			deviceId: opts.deviceId,
			platform: opts.script.platform,
			robot: opts.robot,
			appPackage: opts.script.appPackage,
		});

		const reportId = crypto.randomUUID();
		const report: TestReport = {
			id: reportId,
			mode: "procedural",
			scriptId: opts.script.id,
			deviceId: opts.deviceId,
			platform: opts.script.platform,
			appPackage: opts.script.appPackage,
			startedAt: Date.now(),
			status: "running",
			stepsExecuted: 0,
			stepsPassed: 0,
			stepsFailed: 0,
			errors: [],
		};
		this.store.createReport(report);

		const state: RunState = {
			running: true,
			stopping: false,
			reportId,
			sessionId: session.id,
			currentStep: 0,
		};
		this.activeRuns.set(opts.deviceId, state);

		// Run execution loop
		const runLoop = async () => {
			let stepsPassed = 0;
			let stepsFailed = 0;
			const screenSize = session.screenSize!;
			const { robot, steps } = opts;

			try {
				for (let i = 0; i < steps.length; i++) {
					if (!state.running || state.stopping) {break;}

					const step = steps[i];
					state.currentStep = i + 1;
					let stepPassed = true;

					try {
						// Resolve target element coordinates
						let adjustedParams = step.params;
						if (step.targetElement && hasCoordinates(step.actionType)) {
							const resolved = await waitForElement(
								robot, step, screenSize, step.timeoutMs,
							);
							if (resolved) {
								adjustedParams = { ...step.params, x: resolved.x, y: resolved.y };
							}
							// If not resolved, use original params as fallback
						}

						// Execute the action with timeout
						await withTimeout(
							dispatchAction(robot, step.actionType, adjustedParams),
							step.timeoutMs,
						);

						// Wait for UI to settle after the action
						if (step.delayAfterMs > 0) {
							await new Promise(r => setTimeout(r, step.delayAfterMs));
						}

						// Evaluate assertions
						if (step.assertions.length > 0) {
							const elements = await robot.getElementsOnScreen();
							const { allPassed, results } = evaluateAssertions(step.assertions, elements);
							if (!allPassed) {
								stepPassed = false;
								const failedAssertions = results.filter(r => !r.passed);
								this.store.addReportError(reportId, {
									stepNumber: i + 1,
									actionType: step.actionType,
									message: `Assertion failed: ${failedAssertions.map(r => r.message).join("; ")}`,
									timestamp: Date.now(),
								});

								// Check if any hard assertion failed
								const hardFailure = results.some(r => !r.passed && !r.assertion.soft);
								if (hardFailure) {
									stepsFailed++;
									this.store.updateReport(reportId, {
										stepsExecuted: i + 1, stepsPassed, stepsFailed,
									});
									break; // Stop execution on hard failure
								}
							}
						}
					} catch (e: any) {
						stepPassed = false;
						this.store.addReportError(reportId, {
							stepNumber: i + 1,
							actionType: step.actionType,
							message: e.message,
							timestamp: Date.now(),
						});
					}

					if (stepPassed) {
						stepsPassed++;
					} else {
						stepsFailed++;
					}

					this.store.updateReport(reportId, {
						stepsExecuted: i + 1,
						stepsPassed,
						stepsFailed,
					});
				}
			} catch (e: any) {
				this.store.addReportError(reportId, {
					stepNumber: state.currentStep,
					actionType: "tap",
					message: `Fatal error: ${e.message}`,
					timestamp: Date.now(),
				});
			}

			// Finalize
			state.running = false;
			try { this.sessionManager.endSession(session.id); } catch { /* already ended */ }
			this.store.updateReport(reportId, {
				status: state.stopping ? "stopped" : (stepsFailed > 0 ? "failed" : "passed"),
				endedAt: Date.now(),
				stepsExecuted: state.currentStep,
				stepsPassed,
				stepsFailed,
			});
		};

		runLoop().catch(() => { state.running = false; });

		return reportId;
	}

	stop(deviceId: string): void {
		const state = this.activeRuns.get(deviceId);
		if (state) {state.stopping = true;}
	}

	getStatus(deviceId: string): { running: boolean; currentStep: number; reportId: string } | undefined {
		const state = this.activeRuns.get(deviceId);
		if (!state) {return undefined;}
		return { running: state.running, currentStep: state.currentStep, reportId: state.reportId };
	}
}

function hasCoordinates(actionType: string): boolean {
	return actionType === "tap" || actionType === "doubleTap" || actionType === "longPress";
}

async function waitForElement(
	robot: Robot,
	step: TestScriptStep,
	screenSize: { width: number; height: number; scale: number },
	timeoutMs: number,
): Promise<{ x: number; y: number } | null> {
	const deadline = Date.now() + timeoutMs;
	const pollInterval = 500;

	while (Date.now() < deadline) {
		const elements = await robot.getElementsOnScreen();
		const match = findElement(step.targetElement!, elements, screenSize);
		if (match && match.confidence >= 0.4) {
			return { x: match.x, y: match.y };
		}
		if (Date.now() + pollInterval >= deadline) {break;}
		await new Promise(r => setTimeout(r, pollInterval));
	}

	return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Step timed out after ${ms}ms`)), ms)
		),
	]);
}

async function dispatchAction(robot: Robot, actionType: string, params: any): Promise<void> {
	switch (actionType) {
		case "tap": { const p = params as TapParams; await robot.tap(p.x, p.y); break; }
		case "doubleTap": { const p = params as DoubleTapParams; await robot.doubleTap(p.x, p.y); break; }
		case "longPress": { const p = params as LongPressParams; await robot.longPress(p.x, p.y, p.duration); break; }
		case "swipe": {
			const p = params as SwipeParams;
			if (p.x !== undefined && p.y !== undefined) {
				await robot.swipeFromCoordinate(p.x, p.y, p.direction, p.distance);
			} else {
				await robot.swipe(p.direction);
			}
			break;
		}
		case "sendKeys": { const p = params as SendKeysParams; await robot.sendKeys(p.text); break; }
		case "pressButton": { const p = params as PressButtonParams; await robot.pressButton(p.button as Button); break; }
		case "launchApp": { const p = params as LaunchAppParams; await robot.launchApp(p.packageName, p.locale); break; }
		case "terminateApp": { const p = params as TerminateAppParams; await robot.terminateApp(p.packageName); break; }
		case "openUrl": { const p = params as OpenUrlParams; await robot.openUrl(p.url); break; }
		case "setOrientation": { const p = params as SetOrientationParams; await robot.setOrientation(p.orientation); break; }
	}
}
