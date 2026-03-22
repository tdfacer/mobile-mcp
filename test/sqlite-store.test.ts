import assert from "node:assert";
import { SqliteStore } from "../src/testing/sqlite-store";
import { TestSession, TestAction, TestScript, TestReport, ReportError } from "../src/testing/schemas";

describe("SqliteStore", () => {
	let store: SqliteStore;

	beforeEach(() => {
		store = new SqliteStore(":memory:");
	});

	afterEach(() => {
		store.close();
	});

	describe("sessions", () => {
		const session: TestSession = {
			id: "sess-1",
			mode: "monkey",
			deviceId: "device-1",
			platform: "android",
			appPackage: "com.example.app",
			screenSize: { width: 1080, height: 1920, scale: 2.0 },
			startedAt: 1000,
			actionCount: 0,
		};

		it("should create and get a session", () => {
			store.createSession(session);
			const result = store.getSession("sess-1");
			assert.ok(result);
			assert.equal(result.id, "sess-1");
			assert.equal(result.mode, "monkey");
			assert.equal(result.deviceId, "device-1");
			assert.equal(result.platform, "android");
			assert.equal(result.appPackage, "com.example.app");
			assert.deepEqual(result.screenSize, { width: 1080, height: 1920, scale: 2.0 });
			assert.equal(result.startedAt, 1000);
			assert.equal(result.endedAt, undefined);
			assert.equal(result.actionCount, 0);
		});

		it("should return undefined for missing session", () => {
			assert.equal(store.getSession("nope"), undefined);
		});

		it("should update a session", () => {
			store.createSession(session);
			store.updateSession("sess-1", { endedAt: 2000, actionCount: 42 });
			const result = store.getSession("sess-1")!;
			assert.equal(result.endedAt, 2000);
			assert.equal(result.actionCount, 42);
		});

		it("should list sessions", () => {
			store.createSession(session);
			store.createSession({ ...session, id: "sess-2", startedAt: 2000 });
			const all = store.listSessions();
			assert.equal(all.length, 2);
			assert.equal(all[0].id, "sess-2"); // most recent first
		});

		it("should list sessions with limit", () => {
			store.createSession(session);
			store.createSession({ ...session, id: "sess-2", startedAt: 2000 });
			const limited = store.listSessions(1);
			assert.equal(limited.length, 1);
		});
	});

	describe("actions", () => {
		beforeEach(() => {
			store.createSession({
				id: "sess-1", mode: "recording", deviceId: "d1", platform: "android",
				startedAt: 1000, actionCount: 0,
			});
		});

		const action: TestAction = {
			id: "act-1",
			sessionId: "sess-1",
			sequenceNumber: 1,
			type: "tap",
			params: { x: 100, y: 200 },
			timestamp: 1001,
			durationMs: 50,
			result: "success",
			elementsBefore: [{ type: "Button", text: "OK", rect: { x: 90, y: 190, width: 20, height: 20 } }],
			elementsAfter: [],
		};

		it("should create and retrieve actions", () => {
			store.createAction(action);
			store.createAction({ ...action, id: "act-2", sequenceNumber: 2, type: "swipe", params: { direction: "up" } });

			const actions = store.getActionsForSession("sess-1");
			assert.equal(actions.length, 2);
			assert.equal(actions[0].id, "act-1");
			assert.equal(actions[0].type, "tap");
			assert.deepEqual(actions[0].params, { x: 100, y: 200 });
			assert.equal(actions[0].elementsBefore!.length, 1);
			assert.equal(actions[0].elementsBefore![0].text, "OK");
			assert.equal(actions[1].sequenceNumber, 2);
		});

		it("should handle actions with errors", () => {
			store.createAction({ ...action, result: "error", error: "Element not found" });
			const actions = store.getActionsForSession("sess-1");
			assert.equal(actions[0].result, "error");
			assert.equal(actions[0].error, "Element not found");
		});

		it("should handle actions without elements", () => {
			store.createAction({ ...action, elementsBefore: undefined, elementsAfter: undefined });
			const actions = store.getActionsForSession("sess-1");
			assert.equal(actions[0].elementsBefore, undefined);
			assert.equal(actions[0].elementsAfter, undefined);
		});
	});

	describe("scripts", () => {
		const script: TestScript = {
			id: "script-1",
			name: "Login Flow",
			description: "Login and navigate to settings",
			platform: "android",
			appPackage: "com.example.app",
			tags: ["auth", "settings"],
			createdAt: 1000,
			updatedAt: 1000,
		};

		it("should create and get a script", () => {
			store.createScript(script);
			const result = store.getScript("script-1")!;
			assert.equal(result.name, "Login Flow");
			assert.equal(result.description, "Login and navigate to settings");
			assert.deepEqual(result.tags, ["auth", "settings"]);
		});

		it("should update a script", () => {
			store.createScript(script);
			store.updateScript("script-1", { name: "Updated", tags: ["new"], updatedAt: 2000 });
			const result = store.getScript("script-1")!;
			assert.equal(result.name, "Updated");
			assert.deepEqual(result.tags, ["new"]);
			assert.equal(result.updatedAt, 2000);
		});

		it("should list scripts", () => {
			store.createScript(script);
			store.createScript({ ...script, id: "script-2", name: "Other", updatedAt: 2000 });
			const all = store.listScripts();
			assert.equal(all.length, 2);
			assert.equal(all[0].id, "script-2"); // most recent first
		});

		it("should delete a script and its steps", () => {
			store.createScript(script);
			store.createStep({
				id: "step-1", scriptId: "script-1", sequenceNumber: 1,
				actionType: "tap", params: { x: 0, y: 0 },
				assertions: [], timeoutMs: 5000, delayAfterMs: 1000,
			});
			store.deleteScript("script-1");
			assert.equal(store.getScript("script-1"), undefined);
			assert.equal(store.getStepsForScript("script-1").length, 0);
		});
	});

	describe("steps", () => {
		beforeEach(() => {
			store.createScript({
				id: "script-1", name: "Test", description: "", platform: "android",
				tags: [], createdAt: 1000, updatedAt: 1000,
			});
		});

		it("should create and retrieve steps in order", () => {
			store.createStep({
				id: "step-2", scriptId: "script-1", sequenceNumber: 2,
				actionType: "sendKeys", params: { text: "hello", submit: true },
				assertions: [{ type: "screenContainsText", params: { text: "hello" }, soft: false }],
				timeoutMs: 10000, delayAfterMs: 500,
			});
			store.createStep({
				id: "step-1", scriptId: "script-1", sequenceNumber: 1,
				actionType: "tap", params: { x: 100, y: 200 },
				targetElement: { identifier: "login_button", type: "Button" },
				assertions: [], timeoutMs: 5000, delayAfterMs: 1000,
			});

			const steps = store.getStepsForScript("script-1");
			assert.equal(steps.length, 2);
			assert.equal(steps[0].id, "step-1"); // ordered by sequence
			assert.equal(steps[0].actionType, "tap");
			assert.deepEqual(steps[0].targetElement, { identifier: "login_button", type: "Button" });
			assert.equal(steps[1].id, "step-2");
			assert.equal(steps[1].assertions.length, 1);
			assert.equal(steps[1].assertions[0].type, "screenContainsText");
		});

		it("should delete steps for a script", () => {
			store.createStep({
				id: "step-1", scriptId: "script-1", sequenceNumber: 1,
				actionType: "tap", params: { x: 0, y: 0 },
				assertions: [], timeoutMs: 5000, delayAfterMs: 1000,
			});
			store.deleteStepsForScript("script-1");
			assert.equal(store.getStepsForScript("script-1").length, 0);
		});
	});

	describe("reports", () => {
		const report: TestReport = {
			id: "report-1",
			mode: "monkey",
			deviceId: "d1",
			platform: "android",
			appPackage: "com.example.app",
			startedAt: 1000,
			status: "running",
			stepsExecuted: 0,
			stepsPassed: 0,
			stepsFailed: 0,
			errors: [],
		};

		it("should create and get a report", () => {
			store.createReport(report);
			const result = store.getReport("report-1")!;
			assert.equal(result.id, "report-1");
			assert.equal(result.mode, "monkey");
			assert.equal(result.status, "running");
			assert.equal(result.errors.length, 0);
		});

		it("should update a report", () => {
			store.createReport(report);
			store.updateReport("report-1", {
				status: "passed", endedAt: 2000,
				stepsExecuted: 50, stepsPassed: 48, stepsFailed: 2,
			});
			const result = store.getReport("report-1")!;
			assert.equal(result.status, "passed");
			assert.equal(result.endedAt, 2000);
			assert.equal(result.stepsExecuted, 50);
			assert.equal(result.stepsPassed, 48);
			assert.equal(result.stepsFailed, 2);
		});

		it("should list reports with limit", () => {
			store.createReport(report);
			store.createReport({ ...report, id: "report-2", startedAt: 2000 });
			const all = store.listReports();
			assert.equal(all.length, 2);
			const limited = store.listReports(1);
			assert.equal(limited.length, 1);
		});
	});

	describe("report errors", () => {
		beforeEach(() => {
			store.createReport({
				id: "report-1", mode: "monkey", deviceId: "d1", platform: "android",
				startedAt: 1000, status: "running",
				stepsExecuted: 0, stepsPassed: 0, stepsFailed: 0, errors: [],
			});
		});

		it("should add and retrieve report errors", () => {
			const error: ReportError = {
				stepNumber: 5,
				actionType: "tap",
				message: "App crashed",
				screenshotRef: "screenshot-123.png",
				elements: [{ type: "TextView", text: "has stopped", rect: { x: 0, y: 0, width: 100, height: 50 } }],
				timestamp: 1500,
			};
			store.addReportError("report-1", error);
			store.addReportError("report-1", { ...error, stepNumber: 10, message: "ANR" });

			const errors = store.getReportErrors("report-1");
			assert.equal(errors.length, 2);
			assert.equal(errors[0].stepNumber, 5);
			assert.equal(errors[0].message, "App crashed");
			assert.equal(errors[0].elements!.length, 1);
			assert.equal(errors[1].stepNumber, 10);
		});

		it("should include errors when getting report", () => {
			store.addReportError("report-1", {
				stepNumber: 1, actionType: "tap", message: "Failed",
				timestamp: 1100,
			});
			const report = store.getReport("report-1")!;
			assert.equal(report.errors.length, 1);
			assert.equal(report.errors[0].message, "Failed");
		});
	});
});
