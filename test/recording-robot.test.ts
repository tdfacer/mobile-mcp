import assert from "node:assert";
import { RecordingRobot } from "../src/testing/recording-robot";
import { Robot, ScreenElement } from "../src/robot";
import { TestAction } from "../src/testing/schemas";
import { TestStore } from "../src/testing/store";

const testElements: ScreenElement[] = [
	{ type: "Button", text: "OK", rect: { x: 100, y: 200, width: 80, height: 40 } },
];

function createMockRobot(opts?: { throwOn?: string }): Robot {
	return {
		getScreenSize: async () => ({ width: 1080, height: 1920, scale: 2.0 }),
		getScreenshot: async () => Buffer.from("png"),
		getElementsOnScreen: async () => [...testElements],
		listApps: async () => [],
		launchApp: async () => {},
		terminateApp: async () => {},
		installApp: async () => {},
		uninstallApp: async () => {},
		openUrl: async () => {},
		sendKeys: async () => {},
		pressButton: async () => {},
		tap: async () => {
			if (opts?.throwOn === "tap") {throw new Error("tap failed");}
		},
		doubleTap: async () => {},
		longPress: async () => {},
		swipe: async () => {},
		swipeFromCoordinate: async () => {},
		setOrientation: async () => {},
		getOrientation: async () => "portrait" as const,
	};
}

function createMockStore(): TestStore & { actions: TestAction[] } {
	const actions: TestAction[] = [];
	return {
		actions,
		createAction(a: TestAction) { actions.push(a); },
		createSession() {},
		getSession() { return undefined; },
		updateSession() {},
		listSessions() { return []; },
		getActionsForSession() { return actions; },
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

describe("RecordingRobot", () => {
	let store: TestStore & { actions: TestAction[] };

	beforeEach(() => {
		store = createMockStore();
	});

	it("should record a tap action", async () => {
		const inner = createMockRobot();
		const recorder = new RecordingRobot(inner, "sess-1", store);

		await recorder.tap(150, 300);

		assert.equal(store.actions.length, 1);
		const action = store.actions[0];
		assert.equal(action.sessionId, "sess-1");
		assert.equal(action.sequenceNumber, 1);
		assert.equal(action.type, "tap");
		assert.deepEqual(action.params, { x: 150, y: 300 });
		assert.equal(action.result, "success");
		assert.equal(action.error, undefined);
		assert.ok(action.elementsBefore!.length > 0);
		assert.ok(action.elementsAfter!.length > 0);
	});

	it("should record sequential actions with incrementing sequence numbers", async () => {
		const inner = createMockRobot();
		const recorder = new RecordingRobot(inner, "sess-1", store);

		await recorder.tap(100, 200);
		await recorder.swipe("up");
		await recorder.sendKeys("hello");

		assert.equal(store.actions.length, 3);
		assert.equal(store.actions[0].sequenceNumber, 1);
		assert.equal(store.actions[0].type, "tap");
		assert.equal(store.actions[1].sequenceNumber, 2);
		assert.equal(store.actions[1].type, "swipe");
		assert.equal(store.actions[2].sequenceNumber, 3);
		assert.equal(store.actions[2].type, "sendKeys");
	});

	it("should record error and re-throw", async () => {
		const inner = createMockRobot({ throwOn: "tap" });
		const recorder = new RecordingRobot(inner, "sess-1", store);

		await assert.rejects(() => recorder.tap(100, 200), /tap failed/);

		assert.equal(store.actions.length, 1);
		assert.equal(store.actions[0].result, "error");
		assert.equal(store.actions[0].error, "tap failed");
	});

	it("should not capture elements when captureElements is false", async () => {
		const inner = createMockRobot();
		const recorder = new RecordingRobot(inner, "sess-1", store, false);

		await recorder.tap(100, 200);

		assert.equal(store.actions[0].elementsBefore, undefined);
		assert.equal(store.actions[0].elementsAfter, undefined);
	});

	it("should pass through read-only methods without recording", async () => {
		const inner = createMockRobot();
		const recorder = new RecordingRobot(inner, "sess-1", store);

		const size = await recorder.getScreenSize();
		assert.deepEqual(size, { width: 1080, height: 1920, scale: 2.0 });

		const screenshot = await recorder.getScreenshot();
		assert.ok(screenshot);

		const elements = await recorder.getElementsOnScreen();
		assert.equal(elements.length, testElements.length);

		const apps = await recorder.listApps();
		assert.deepEqual(apps, []);

		// None of these should create actions
		assert.equal(store.actions.length, 0);
	});

	it("should record all mutating method types", async () => {
		const inner = createMockRobot();
		const recorder = new RecordingRobot(inner, "sess-1", store);

		await recorder.doubleTap(10, 20);
		await recorder.longPress(30, 40, 1000);
		await recorder.swipeFromCoordinate(50, 60, "left", 300);
		await recorder.pressButton("HOME");
		await recorder.launchApp("com.example", "en-US");
		await recorder.terminateApp("com.example");
		await recorder.openUrl("https://example.com");
		await recorder.setOrientation("landscape");

		assert.equal(store.actions.length, 8);
		assert.equal(store.actions[0].type, "doubleTap");
		assert.equal(store.actions[1].type, "longPress");
		assert.equal(store.actions[2].type, "swipe");
		assert.equal(store.actions[3].type, "pressButton");
		assert.equal(store.actions[4].type, "launchApp");
		assert.equal(store.actions[5].type, "terminateApp");
		assert.equal(store.actions[6].type, "openUrl");
		assert.equal(store.actions[7].type, "setOrientation");
	});
});
