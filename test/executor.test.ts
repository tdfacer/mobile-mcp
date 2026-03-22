import assert from "node:assert";
import { ScriptExecutor } from "../src/testing/procedural/executor";
import { SessionManager } from "../src/testing/session";
import { TestStore } from "../src/testing/store";
import { TestScript, TestScriptStep, TestSession, TestReport, ReportError } from "../src/testing/schemas";
import { Robot, ScreenElement } from "../src/robot";

function createMockStore(): TestStore & { reports: any[]; errors: ReportError[]; reportUpdates: any[] } {
	const sessions: TestSession[] = [];
	const reports: any[] = [];
	const errors: ReportError[] = [];
	const reportUpdates: any[] = [];
	return {
		reports, errors, reportUpdates,
		createSession(s: TestSession) { sessions.push({ ...s }); },
		getSession(id: string) { return sessions.find(s => s.id === id); },
		updateSession(id: string, patch: Partial<TestSession>) {
			const s = sessions.find(s => s.id === id);
			if (s) {Object.assign(s, patch);}
		},
		listSessions() { return [...sessions]; },
		createAction() {},
		getActionsForSession() { return []; },
		createScript() {},
		getScript() { return undefined; },
		updateScript() {},
		listScripts() { return []; },
		deleteScript() {},
		createStep() {},
		getStepsForScript() { return []; },
		deleteStepsForScript() {},
		createReport(r: TestReport) { reports.push({ ...r }); },
		getReport(id: string) { return reports.find((r: any) => r.id === id); },
		updateReport(id: string, patch: Partial<TestReport>) {
			const r = reports.find((r: any) => r.id === id);
			if (r) {Object.assign(r, patch);}
			reportUpdates.push({ id, ...patch });
		},
		listReports() { return [...reports]; },
		addReportError(_reportId: string, error: ReportError) { errors.push(error); },
		getReportErrors() { return [...errors]; },
		close() {},
	};
}

const testElements: ScreenElement[] = [
	{ type: "Button", text: "Login", identifier: "login_btn", rect: { x: 100, y: 500, width: 200, height: 60 } },
	{ type: "TextField", text: "", identifier: "email_field", rect: { x: 100, y: 300, width: 400, height: 50 } },
];

function createMockRobot(opts?: { tapCallback?: (x: number, y: number) => void }): Robot {
	return {
		getScreenSize: async () => ({ width: 1080, height: 1920, scale: 2.0 }),
		getScreenshot: async () => Buffer.from(""),
		getElementsOnScreen: async () => [...testElements],
		listApps: async () => [],
		launchApp: async () => {},
		terminateApp: async () => {},
		installApp: async () => {},
		uninstallApp: async () => {},
		openUrl: async () => {},
		sendKeys: async () => {},
		pressButton: async () => {},
		tap: async (x: number, y: number) => { opts?.tapCallback?.(x, y); },
		doubleTap: async () => {},
		longPress: async () => {},
		swipe: async () => {},
		swipeFromCoordinate: async () => {},
		setOrientation: async () => {},
		getOrientation: async () => "portrait" as const,
	};
}

const script: TestScript = {
	id: "script-1",
	name: "Test Login",
	description: "Test the login flow",
	platform: "android",
	appPackage: "com.example.app",
	tags: [],
	createdAt: 1000,
	updatedAt: 1000,
};

describe("ScriptExecutor", () => {
	let store: TestStore & { reports: any[]; errors: ReportError[]; reportUpdates: any[] };
	let sessionManager: SessionManager;
	let executor: ScriptExecutor;

	beforeEach(() => {
		store = createMockStore();
		sessionManager = new SessionManager(store);
		executor = new ScriptExecutor(store, sessionManager);
	});

	it("should execute a simple script with all steps passing", async () => {
		const steps: TestScriptStep[] = [
			{ id: "s1", scriptId: "script-1", sequenceNumber: 1, actionType: "tap", params: { x: 200, y: 530 }, assertions: [], timeoutMs: 5000 },
			{ id: "s2", scriptId: "script-1", sequenceNumber: 2, actionType: "swipe", params: { direction: "up" as const }, assertions: [], timeoutMs: 5000 },
		];

		const reportId = await executor.execute({
			script, steps, deviceId: "d1", robot: createMockRobot(),
		});

		// Wait for async execution
		await new Promise(r => setTimeout(r, 100));

		assert.ok(reportId);
		const report = store.reports.find(r => r.id === reportId);
		assert.ok(report);
		assert.equal(report.status, "passed");
		assert.equal(report.stepsExecuted, 2);
		assert.equal(report.stepsPassed, 2);
		assert.equal(report.stepsFailed, 0);
	});

	it("should re-target coordinates using element matcher", async () => {
		const taps: { x: number; y: number }[] = [];
		const robot = createMockRobot({ tapCallback: (x, y) => taps.push({ x, y }) });

		const steps: TestScriptStep[] = [
			{
				id: "s1", scriptId: "script-1", sequenceNumber: 1,
				actionType: "tap",
				params: { x: 999, y: 999 }, // Original coordinates (different from element)
				targetElement: { identifier: "login_btn" },
				assertions: [],
				timeoutMs: 5000,
			},
		];

		await executor.execute({ script, steps, deviceId: "d1", robot });
		await new Promise(r => setTimeout(r, 100));

		assert.equal(taps.length, 1);
		// Should have tapped center of login_btn (100+200/2=200, 500+60/2=530), not original 999,999
		assert.equal(taps[0].x, 200);
		assert.equal(taps[0].y, 530);
	});

	it("should fail on hard assertion failure and stop", async () => {
		const steps: TestScriptStep[] = [
			{
				id: "s1", scriptId: "script-1", sequenceNumber: 1,
				actionType: "tap", params: { x: 200, y: 530 },
				assertions: [{ type: "elementExists", params: { identifier: "nonexistent" }, soft: false }],
				timeoutMs: 5000,
			},
			{
				id: "s2", scriptId: "script-1", sequenceNumber: 2,
				actionType: "tap", params: { x: 100, y: 100 },
				assertions: [],
				timeoutMs: 5000,
			},
		];

		await executor.execute({ script, steps, deviceId: "d1", robot: createMockRobot() });
		await new Promise(r => setTimeout(r, 100));

		const report = store.reports[0];
		assert.equal(report.status, "failed");
		assert.equal(report.stepsExecuted, 1); // Stopped after first step
		assert.equal(report.stepsFailed, 1);
		assert.equal(store.errors.length, 1);
		assert.ok(store.errors[0].message.includes("Assertion failed"));
	});

	it("should continue on soft assertion failure", async () => {
		const steps: TestScriptStep[] = [
			{
				id: "s1", scriptId: "script-1", sequenceNumber: 1,
				actionType: "tap", params: { x: 200, y: 530 },
				assertions: [{ type: "elementExists", params: { identifier: "nonexistent" }, soft: true }],
				timeoutMs: 5000,
			},
			{
				id: "s2", scriptId: "script-1", sequenceNumber: 2,
				actionType: "swipe", params: { direction: "up" as const },
				assertions: [],
				timeoutMs: 5000,
			},
		];

		await executor.execute({ script, steps, deviceId: "d1", robot: createMockRobot() });
		await new Promise(r => setTimeout(r, 100));

		const report = store.reports[0];
		assert.equal(report.stepsExecuted, 2); // Continued past soft failure
		assert.equal(report.stepsPassed, 2); // Soft failures don't fail the step
		assert.equal(report.stepsFailed, 0);
	});

	it("should prevent duplicate runs on same device", async () => {
		const steps: TestScriptStep[] = [
			{ id: "s1", scriptId: "script-1", sequenceNumber: 1, actionType: "tap", params: { x: 100, y: 200 }, assertions: [], timeoutMs: 5000 },
		];

		await executor.execute({ script, steps, deviceId: "d1", robot: createMockRobot() });

		await assert.rejects(
			() => executor.execute({ script, steps, deviceId: "d1", robot: createMockRobot() }),
			/already running/
		);
	});
});
