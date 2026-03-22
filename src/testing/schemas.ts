import { ScreenElement, ScreenSize } from "../robot";

// ---------------------------------------------------------------------------
// Action types — 1:1 mapping to Robot interface methods
// ---------------------------------------------------------------------------

export const ACTION_TYPES = [
	"tap",
	"doubleTap",
	"longPress",
	"swipe",
	"sendKeys",
	"pressButton",
	"launchApp",
	"terminateApp",
	"openUrl",
	"setOrientation",
] as const;

export type ActionType = typeof ACTION_TYPES[number];

export interface TapParams { x: number; y: number }
export interface DoubleTapParams { x: number; y: number }
export interface LongPressParams { x: number; y: number; duration: number }
export interface SwipeParams { direction: "up" | "down" | "left" | "right"; x?: number; y?: number; distance?: number }
export interface SendKeysParams { text: string; submit?: boolean }
export interface PressButtonParams { button: string }
export interface LaunchAppParams { packageName: string; locale?: string }
export interface TerminateAppParams { packageName: string }
export interface OpenUrlParams { url: string }
export interface SetOrientationParams { orientation: "portrait" | "landscape" }

export type ActionParams =
	| TapParams
	| DoubleTapParams
	| LongPressParams
	| SwipeParams
	| SendKeysParams
	| PressButtonParams
	| LaunchAppParams
	| TerminateAppParams
	| OpenUrlParams
	| SetOrientationParams;

// Maps ActionType to its corresponding params type for type-safe usage
export interface ActionParamsMap {
	tap: TapParams;
	doubleTap: DoubleTapParams;
	longPress: LongPressParams;
	swipe: SwipeParams;
	sendKeys: SendKeysParams;
	pressButton: PressButtonParams;
	launchApp: LaunchAppParams;
	terminateApp: TerminateAppParams;
	openUrl: OpenUrlParams;
	setOrientation: SetOrientationParams;
}

// ---------------------------------------------------------------------------
// Test Action — a single recorded device interaction
// ---------------------------------------------------------------------------

export interface TestAction {
	id: string;
	sessionId: string;
	sequenceNumber: number;

	type: ActionType;
	params: ActionParams;
	timestamp: number;
	durationMs: number;
	result: "success" | "error";
	error?: string;

	elementsBefore?: ScreenElement[];
	elementsAfter?: ScreenElement[];
	screenshotBeforeRef?: string;
	screenshotAfterRef?: string;
}

// ---------------------------------------------------------------------------
// Element Matcher — identifies a UI element for playback
// ---------------------------------------------------------------------------

export interface ElementMatcher {
	identifier?: string;
	label?: string;
	text?: string;
	type?: string;
	name?: string;

	// Fallback: coordinates as fraction of screen size (0.0–1.0)
	relativeX?: number;
	relativeY?: number;
}

// ---------------------------------------------------------------------------
// Step Assertion — verifies screen state after a step
// ---------------------------------------------------------------------------

export type AssertionType =
	| "elementExists"
	| "elementHasText"
	| "screenContainsText"
	| "noErrorDialog";

export interface StepAssertion {
	type: AssertionType;
	params: Record<string, string>;
	soft: boolean;
}

// ---------------------------------------------------------------------------
// Test Script — a replayable sequence of steps
// ---------------------------------------------------------------------------

export interface TestScript {
	id: string;
	name: string;
	description: string;
	platform: "android" | "ios";
	appPackage?: string;
	tags: string[];
	createdAt: number;
	updatedAt: number;
}

export interface TestScriptStep {
	id: string;
	scriptId: string;
	sequenceNumber: number;

	actionType: ActionType;
	params: ActionParams;

	targetElement?: ElementMatcher;
	assertions: StepAssertion[];
	timeoutMs: number;
	delayAfterMs: number;

	// If set, the executor waits until this element appears on screen before executing the step.
	// Polls every 500ms up to timeoutMs. Useful for waiting for screens to load.
	waitForElement?: ElementMatcher;
}

// Default delays (ms) applied after each action type during script building.
// Gives the UI time to respond before the next step executes.
export const DEFAULT_ACTION_DELAYS: Record<ActionType, number> = {
	tap: 1000,
	doubleTap: 1000,
	longPress: 1000,
	swipe: 800,
	sendKeys: 500,
	pressButton: 800,
	launchApp: 2000,
	terminateApp: 1000,
	openUrl: 2000,
	setOrientation: 1000,
};

// ---------------------------------------------------------------------------
// Test Report — results from a monkey or procedural test run
// ---------------------------------------------------------------------------

export type ReportStatus = "running" | "passed" | "failed" | "stopped";

export interface TestReport {
	id: string;
	mode: "monkey" | "procedural";
	scriptId?: string;
	deviceId: string;
	platform: "android" | "ios";
	appPackage?: string;
	startedAt: number;
	endedAt?: number;
	status: ReportStatus;

	stepsExecuted: number;
	stepsPassed: number;
	stepsFailed: number;

	errors: ReportError[];
}

export interface ReportError {
	stepNumber: number;
	actionType: ActionType;
	message: string;
	screenshotRef?: string;
	elements?: ScreenElement[];
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Test Session — runtime state for an active test run
// ---------------------------------------------------------------------------

export type SessionMode = "monkey" | "recording" | "procedural";

export interface TestSession {
	id: string;
	mode: SessionMode;
	deviceId: string;
	platform: "android" | "ios";
	appPackage?: string;
	screenSize?: ScreenSize;
	startedAt: number;
	endedAt?: number;
	actionCount: number;
}

// ---------------------------------------------------------------------------
// Monkey Test Config
// ---------------------------------------------------------------------------

export interface MonkeyConfig {
	maxActions?: number;
	maxDurationMs?: number;
	seed?: number;
	actionWeights?: Partial<Record<MonkeyActionKind, number>>;
	captureScreenshots?: boolean;
}

export type MonkeyActionKind =
	| "tapElement"
	| "tapRandom"
	| "swipe"
	| "pressBack"
	| "typeText"
	| "longPress";

export const DEFAULT_MONKEY_WEIGHTS: Record<MonkeyActionKind, number> = {
	tapElement: 40,
	tapRandom: 20,
	swipe: 20,
	pressBack: 10,
	typeText: 5,
	longPress: 5,
};
