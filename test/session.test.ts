import assert from "node:assert";
import { SessionManager } from "../src/testing/session";
import { TestStore } from "../src/testing/store";
import { TestSession } from "../src/testing/schemas";
import { Robot, ScreenSize } from "../src/robot";

function createMockStore(): TestStore & { sessions: TestSession[] } {
	const sessions: TestSession[] = [];
	return {
		sessions,
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
		createReport() {},
		getReport() { return undefined; },
		updateReport() {},
		listReports() { return []; },
		addReportError() {},
		getReportErrors() { return []; },
		close() {},
	};
}

function createMockRobot(screenSize?: ScreenSize): Robot {
	const size = screenSize ?? { width: 1080, height: 1920, scale: 2.0 };
	return {
		getScreenSize: async () => size,
		getScreenshot: async () => Buffer.from(""),
		getElementsOnScreen: async () => [],
		listApps: async () => [],
		launchApp: async () => {},
		terminateApp: async () => {},
		installApp: async () => {},
		uninstallApp: async () => {},
		openUrl: async () => {},
		sendKeys: async () => {},
		pressButton: async () => {},
		tap: async () => {},
		doubleTap: async () => {},
		longPress: async () => {},
		swipe: async () => {},
		swipeFromCoordinate: async () => {},
		setOrientation: async () => {},
		getOrientation: async () => "portrait" as const,
	};
}

describe("SessionManager", () => {
	let store: TestStore & { sessions: TestSession[] };
	let manager: SessionManager;
	let robot: Robot;

	beforeEach(() => {
		store = createMockStore();
		manager = new SessionManager(store);
		robot = createMockRobot();
	});

	it("should start a session", async () => {
		const session = await manager.startSession({
			mode: "monkey", deviceId: "d1", platform: "android", robot,
			appPackage: "com.example.app",
		});

		assert.ok(session.id);
		assert.equal(session.mode, "monkey");
		assert.equal(session.deviceId, "d1");
		assert.equal(session.platform, "android");
		assert.equal(session.appPackage, "com.example.app");
		assert.deepEqual(session.screenSize, { width: 1080, height: 1920, scale: 2.0 });
		assert.equal(session.actionCount, 0);
		assert.ok(session.startedAt > 0);
		assert.equal(session.endedAt, undefined);
		assert.equal(store.sessions.length, 1);
	});

	it("should prevent duplicate sessions for same device", async () => {
		await manager.startSession({ mode: "monkey", deviceId: "d1", platform: "android", robot });

		await assert.rejects(
			() => manager.startSession({ mode: "recording", deviceId: "d1", platform: "android", robot }),
			/already has an active/
		);
	});

	it("should allow sessions on different devices", async () => {
		await manager.startSession({ mode: "monkey", deviceId: "d1", platform: "android", robot });
		const s2 = await manager.startSession({ mode: "recording", deviceId: "d2", platform: "android", robot });
		assert.ok(s2.id);
		assert.equal(store.sessions.length, 2);
	});

	it("should end a session", async () => {
		const session = await manager.startSession({ mode: "monkey", deviceId: "d1", platform: "android", robot });
		const ended = manager.endSession(session.id);

		assert.ok(ended.endedAt);
		assert.equal(manager.getActiveSessionForDevice("d1"), undefined);
	});

	it("should throw on ending non-existent session", () => {
		assert.throws(() => manager.endSession("nope"), /No active session/);
	});

	it("should get session by id", async () => {
		const session = await manager.startSession({ mode: "monkey", deviceId: "d1", platform: "android", robot });
		const found = manager.getSession(session.id);
		assert.ok(found);
		assert.equal(found!.id, session.id);
	});

	it("should fall back to store for ended sessions", async () => {
		const session = await manager.startSession({ mode: "monkey", deviceId: "d1", platform: "android", robot });
		manager.endSession(session.id);

		// No longer in active map, but store still has it
		const found = manager.getSession(session.id);
		assert.ok(found);
	});

	it("should increment action count", async () => {
		const session = await manager.startSession({ mode: "monkey", deviceId: "d1", platform: "android", robot });
		assert.equal(manager.incrementActionCount(session.id), 1);
		assert.equal(manager.incrementActionCount(session.id), 2);
		assert.equal(manager.incrementActionCount(session.id), 3);

		const found = manager.getSession(session.id)!;
		assert.equal(found.actionCount, 3);
	});

	it("should throw when incrementing non-existent session", () => {
		assert.throws(() => manager.incrementActionCount("nope"), /No active session/);
	});

	it("should allow new session on device after ending previous", async () => {
		const s1 = await manager.startSession({ mode: "monkey", deviceId: "d1", platform: "android", robot });
		manager.endSession(s1.id);
		const s2 = await manager.startSession({ mode: "recording", deviceId: "d1", platform: "android", robot });
		assert.ok(s2.id);
		assert.notEqual(s1.id, s2.id);
	});
});
