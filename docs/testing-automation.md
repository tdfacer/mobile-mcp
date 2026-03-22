# Mobile Testing Automation

> **Audience**: Developers and agents working on or consuming the mobile-mcp testing system.
> **Scope**: Android first. The architecture supports iOS and other platforms but initial implementation targets Android only.

---

## Overview

Mobile-mcp gains three testing modes that build on top of the existing device control primitives (`tap`, `swipe`, `sendKeys`, `getElementsOnScreen`, etc.). All three modes are exposed as MCP tools so an autonomous agent harness can orchestrate them programmatically.

### Modes

1. **Monkey testing** — Random interactions against a running app. Detects crashes, ANRs, stuck states. Produces a report.
2. **Data collection** — An agent performs a task (e.g. "login and navigate to settings") while every action is recorded. The recording is saved as a replayable test script.
3. **Procedural testing** — Replays a saved script, verifying each step's outcome against expected state.

### Design Principles

- **Transparent recording**: Data collection mode intercepts existing `mobile_*` MCP tool calls via a proxy — the agent doesn't change its behavior.
- **Smart element matching**: Procedural playback identifies elements by stable attributes (`identifier > label+type > text+type`), falling back to coordinates only as a last resort.
- **Swappable storage**: A `TestStore` interface abstracts persistence. SQLite ships first; a REST API adapter can replace it later without changing any calling code.
- **Platform-agnostic core**: Schemas, storage, session management, and playback logic are platform-independent. Platform-specific behavior lives only in the `Robot` implementations and in detection heuristics (e.g. crash detection reads logcat on Android).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        MCP Tools                            │
│  mobile_monkey_*   mobile_record_*   mobile_test_*          │
└──────────┬──────────────┬──────────────────┬────────────────┘
           │              │                  │
     ┌─────▼─────┐ ┌─────▼──────┐  ┌───────▼────────┐
     │  Monkey    │ │  Recording │  │  Procedural    │
     │  Runner    │ │  Proxy     │  │  Executor      │
     └─────┬─────┘ └─────┬──────┘  └───────┬────────┘
           │              │                  │
     ┌─────▼──────────────▼──────────────────▼────────┐
     │              Session Manager                    │
     │   (lifecycle, screenshot capture, state snaps)  │
     └──────────────────────┬─────────────────────────┘
                            │
     ┌──────────────────────▼─────────────────────────┐
     │                  TestStore                      │
     │          (SQLite now, API later)                │
     └──────────────────────┬─────────────────────────┘
                            │
     ┌──────────────────────▼─────────────────────────┐
     │              Robot Interface                    │
     │  AndroidRobot │ IosRobot │ MobileDevice │ ...  │
     └────────────────────────────────────────────────┘
```

---

## Data Model

### Action

An action is a single device interaction recorded with its context.

```typescript
interface TestAction {
  // Identity
  id: string;
  sessionId: string;
  sequenceNumber: number;

  // What happened
  type: ActionType;
  params: Record<string, unknown>;
  timestamp: number;
  durationMs: number;
  result: "success" | "error";
  error?: string;

  // Context captured around the action
  elementsBefore?: ScreenElement[];
  elementsAfter?: ScreenElement[];
  screenshotBeforeRef?: string;
  screenshotAfterRef?: string;
}

type ActionType =
  | "tap"
  | "doubleTap"
  | "longPress"
  | "swipe"
  | "sendKeys"
  | "pressButton"
  | "launchApp"
  | "terminateApp"
  | "openUrl"
  | "setOrientation";
```

Every `ActionType` maps 1:1 to a method on the `Robot` interface. The `params` object mirrors the method's arguments:

| ActionType     | params                                        |
|----------------|-----------------------------------------------|
| tap            | `{ x, y }`                                    |
| doubleTap      | `{ x, y }`                                    |
| longPress      | `{ x, y, duration }`                          |
| swipe          | `{ direction, x?, y?, distance? }`            |
| sendKeys       | `{ text, submit? }`                           |
| pressButton    | `{ button }`                                  |
| launchApp      | `{ packageName, locale? }`                    |
| terminateApp   | `{ packageName }`                             |
| openUrl        | `{ url }`                                     |
| setOrientation | `{ orientation }`                             |

### Test Script

A replayable sequence of steps produced by data collection mode.

```typescript
interface TestScript {
  id: string;
  name: string;
  description: string;           // Human task: "login and go to settings"
  platform: "android" | "ios";
  appPackage?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

interface TestScriptStep {
  id: string;
  scriptId: string;
  sequenceNumber: number;

  // The action to replay
  actionType: ActionType;
  params: Record<string, unknown>;

  // Element matching context (used during playback instead of raw coordinates)
  targetElement?: ElementMatcher;

  // Optional assertions to verify after this step
  assertions: StepAssertion[];

  // Timeout before failing this step (ms)
  timeoutMs: number;
}
```

### Element Matching

During playback, raw coordinates are unreliable across devices and app versions. Steps include an `ElementMatcher` that identifies the target element by its attributes, falling back through a priority chain:

```typescript
interface ElementMatcher {
  // Tried in order; first match wins
  identifier?: string;           // accessibilityIdentifier / resource-id
  label?: string;                // accessibility label / content-desc
  text?: string;                 // visible text
  type?: string;                 // element type (Button, TextField, etc.)
  name?: string;                 // element name

  // Fallback: coordinates relative to screen size (0.0-1.0)
  // Used only when no attribute match is found
  relativeX?: number;
  relativeY?: number;
}
```

Matching strategy during playback:
1. If `identifier` is set, find element with matching identifier. Done.
2. If `label` + `type` are set, find element matching both. Done.
3. If `text` + `type` are set, find element matching both. Done.
4. If `text` alone is set, find element matching text. Done.
5. Fall back to `relativeX/relativeY` scaled to current screen size.

### Assertions

```typescript
interface StepAssertion {
  type: "elementExists" | "elementHasText" | "screenContainsText" | "noErrorDialog";
  params: Record<string, string>;
  soft: boolean;                 // soft = log warning; hard = fail step
}
```

### Test Report

```typescript
interface TestReport {
  id: string;
  mode: "monkey" | "procedural";
  scriptId?: string;             // for procedural mode
  deviceId: string;
  platform: "android" | "ios";
  appPackage?: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "passed" | "failed" | "stopped";

  stepsExecuted: number;
  stepsPassed: number;
  stepsFailed: number;

  errors: ReportError[];
}

interface ReportError {
  stepNumber: number;
  actionType: ActionType;
  message: string;
  screenshotRef?: string;
  elements?: ScreenElement[];
  timestamp: number;
}
```

---

## Storage

### Interface

```typescript
interface TestStore {
  // Actions
  saveAction(action: TestAction): void;
  getSessionActions(sessionId: string): TestAction[];

  // Scripts
  saveScript(script: TestScript): void;
  getScript(id: string): TestScript | null;
  listScripts(filter?: { platform?: string; tag?: string }): TestScript[];
  deleteScript(id: string): void;
  saveScriptStep(step: TestScriptStep): void;
  getScriptSteps(scriptId: string): TestScriptStep[];

  // Reports
  saveReport(report: TestReport): void;
  getReport(id: string): TestReport | null;
  listReports(filter?: { mode?: string; scriptId?: string }): TestReport[];
  saveReportError(error: ReportError & { reportId: string }): void;

  // Screenshots
  saveScreenshot(id: string, data: Buffer): void;
  getScreenshot(id: string): Buffer | null;
}
```

### SQLite Implementation

Initial implementation uses SQLite via `better-sqlite3`. Database location: configurable, defaults to `~/.mobile-mcp/test-data.db`.

Tables mirror the interfaces above. Screenshots are stored as files on disk (referenced by ID); metadata lives in SQLite.

A `migrations/` directory contains numbered SQL files. The storage layer auto-runs pending migrations on startup.

### Future: API Adapter

A second `TestStore` implementation will forward calls to a REST API backed by Postgres or MongoDB. The interface stays the same — callers don't know or care which backend is active.

---

## Mode 1: Monkey Testing

### Flow

1. Agent calls `mobile_monkey_test_start` with device, app package, and config.
2. Runner launches the app, creates a session.
3. Loop (until duration/count limit or stop signal):
   a. Get screen elements and screen size.
   b. Pick a random action via weighted generator.
   c. Execute the action through the Robot.
   d. Record the action via session manager.
   e. Check for errors (crash detection).
4. Generate report. Return report ID.

### Random Action Generator

Weighted random selection from:

| Action          | Default Weight | Notes                                      |
|-----------------|---------------:|--------------------------------------------|
| Tap element     | 40             | Pick a random visible element, tap center   |
| Tap random xy   | 20             | Random coordinates within safe screen area  |
| Swipe           | 20             | Random direction from center                |
| Press BACK      | 10             | Android-specific                            |
| Type text       | 5              | Only if a text field is focused             |
| Long press      | 5              | Random element or coordinate                |

Weights are configurable. A `seed` parameter makes runs reproducible (same seed = same sequence given same screen states).

### Crash Detection (Android)

- **App exit**: After each action, verify the app is still in the foreground. On Android, check via `adb shell dumpsys activity activities | grep mResumedActivity`.
- **Crash dialogs**: Look for elements with text matching known patterns ("has stopped", "keeps stopping", "isn't responding").
- **Stuck state**: If `getElementsOnScreen()` returns identical results for N consecutive actions (default N=5), flag as potentially stuck.
- **Logcat**: Optionally tail `adb logcat` for fatal exceptions during the session.

Platform-specific detection is isolated behind a `CrashDetector` interface so iOS support can be added later:

```typescript
interface CrashDetector {
  isAppInForeground(device: string, packageName: string): Promise<boolean>;
  detectCrashDialog(elements: ScreenElement[]): string | null;
  detectStuckState(history: ScreenElement[][]): boolean;
}
```

### MCP Tools

| Tool                          | Params                                                        | Returns                      |
|-------------------------------|---------------------------------------------------------------|-------------------------------|
| `mobile_monkey_start`         | device, appPackage?, maxActions?, maxDurationMs?, seed?        | reportId, sessionId           |
| `mobile_monkey_status`        | device                                                        | progress, steps executed      |
| `mobile_monkey_stop`          | device                                                        | final report                  |
| `mobile_monkey_report`        | reportId                                                      | full report with errors       |

---

## Mode 2: Data Collection

### Flow

1. Agent calls `mobile_record_start` with device and task description.
2. System activates recording mode: swaps the device's `Robot` with a `RecordingRobot` proxy.
3. Agent performs the task using normal `mobile_*` MCP tools (tap, swipe, type, etc.).
4. Each tool call is intercepted by the proxy, which captures before/after state and records the action.
5. Agent calls `mobile_record_stop`.
6. Agent calls `mobile_record_save_script` to save the recorded session as a replayable script.

### Recording Robot Proxy

`RecordingRobot` implements the `Robot` interface and wraps an inner `Robot`:

```typescript
class RecordingRobot implements Robot {
  constructor(
    private inner: Robot,
    private session: TestSession,
  ) {}

  async tap(x: number, y: number): Promise<void> {
    const before = await this.inner.getElementsOnScreen();
    const start = Date.now();
    await this.inner.tap(x, y);
    const duration = Date.now() - start;
    const after = await this.inner.getElementsOnScreen();

    this.session.recordAction({
      type: "tap",
      params: { x, y },
      durationMs: duration,
      result: "success",
      elementsBefore: before,
      elementsAfter: after,
    });
  }

  // ... same pattern for all Robot methods
}
```

### Script Building

When saving a recorded session as a script, the system:

1. Takes the raw action sequence from the session.
2. For each action with coordinates (tap, longPress, etc.), finds the element at those coordinates from `elementsBefore` and builds an `ElementMatcher`.
3. Auto-generates basic assertions from `elementsAfter` (e.g. if a new screen appeared, assert key elements exist).
4. Saves the script and its steps to the store.

### MCP Tools

| Tool                              | Params                                    | Returns                        |
|-----------------------------------|-------------------------------------------|--------------------------------|
| `mobile_recording_start`          | device, taskDescription?, appPackage?     | sessionId                      |
| `mobile_recording_stop`           | device                                    | actionCount, durationMs        |
| `mobile_recording_build_script`   | sessionId, name, description?, tags?      | scriptId, stepCount            |

---

## Mode 3: Procedural Testing

### Flow

1. Agent calls `mobile_test_run_script` with a script ID and device.
2. Executor loads the script and its steps.
3. For each step:
   a. Get current screen elements.
   b. Match the target element using the `ElementMatcher` priority chain.
   c. If no match, wait and retry (up to `timeoutMs`).
   d. Execute the action via the Robot.
   e. Run assertions if present.
   f. Record step result in the report.
4. Finalize report. Return report ID.

### Element Matching During Playback

The executor doesn't replay raw coordinates. It uses the `ElementMatcher` attached to each step:

```typescript
function findTargetElement(
  matcher: ElementMatcher,
  elements: ScreenElement[],
  screenSize: ScreenSize,
): { x: number; y: number } | null {
  // 1. Match by identifier (most stable)
  if (matcher.identifier) {
    const el = elements.find(e => e.identifier === matcher.identifier);
    if (el) return centerOf(el.rect);
  }

  // 2. Match by label + type
  if (matcher.label && matcher.type) {
    const el = elements.find(e => e.label === matcher.label && e.type === matcher.type);
    if (el) return centerOf(el.rect);
  }

  // 3. Match by text + type
  if (matcher.text && matcher.type) {
    const el = elements.find(e => e.text === matcher.text && e.type === matcher.type);
    if (el) return centerOf(el.rect);
  }

  // 4. Match by text alone
  if (matcher.text) {
    const el = elements.find(e => e.text === matcher.text);
    if (el) return centerOf(el.rect);
  }

  // 5. Relative coordinate fallback
  if (matcher.relativeX !== undefined && matcher.relativeY !== undefined) {
    return {
      x: Math.round(matcher.relativeX * screenSize.width),
      y: Math.round(matcher.relativeY * screenSize.height),
    };
  }

  return null;
}
```

### Retry Logic

If the target element isn't found immediately, the executor waits and retries:
- Poll interval: 500ms
- Default timeout per step: 10,000ms (configurable per step)
- On timeout: mark step as failed, capture screenshot, continue or halt based on assertion softness.

### MCP Tools

| Tool                          | Params                                                      | Returns                       |
|-------------------------------|-------------------------------------------------------------|-------------------------------|
| `mobile_test_run_script`      | device, scriptId                                            | reportId, stepCount           |
| `mobile_test_run_status`      | device                                                      | progress, current step        |
| `mobile_test_stop_script`     | device                                                      | reportId, stopping            |
| `mobile_test_get_report`      | reportId                                                    | full report with per-step results |
| `mobile_test_list_reports`    | limit?                                                      | report list                   |
| `mobile_test_add_assertion`   | scriptId, stepSequence, assertionType, params, soft?        | assertionCount                |
| `mobile_script_list`          |                                                             | script list with metadata     |
| `mobile_script_get`           | scriptId                                                    | script + steps                |
| `mobile_script_delete`        | scriptId                                                    | confirmation                  |
| `mobile_script_export`        | scriptId                                                    | JSON blob (version 1)        |

---

## Platform Strategy

### Android First

The initial implementation targets Android:
- `AndroidRobot` is the most mature Robot implementation.
- Crash detection uses `adb` commands (logcat, dumpsys).
- Element hierarchy comes from UIAutomator (`resource-id`, `content-desc`, `text`).

### Extending to iOS

All platform-specific logic is behind interfaces:
- `Robot` for device control (already exists for iOS).
- `CrashDetector` for error detection (implement iOS variant later).
- `ElementMatcher` attributes map to both platforms (identifier = resource-id on Android, rawIdentifier on iOS).

No Android-specific types leak into the schema, storage, session, or MCP tool layers. Adding iOS support means implementing `IosCrashDetector` and verifying element matching works with WDA's element attributes.

---

## File Organization

New files live under `src/testing/`:

```
src/testing/
  schemas.ts          # TestAction, TestScript, TestScriptStep, TestReport, etc.
  store.ts            # TestStore interface
  sqlite-store.ts     # SQLite TestStore implementation
  session.ts          # TestSession manager
  recording-robot.ts  # RecordingRobot proxy
  monkey/
    action-generator.ts
    crash-detector.ts # CrashDetector interface + AndroidCrashDetector
    runner.ts
  procedural/
    element-matcher.ts
    executor.ts
    assertions.ts
  tools.ts            # MCP tool registrations for all three modes
```

Existing files (`server.ts`, `robot.ts`, etc.) are modified minimally — primarily to wire in recording mode and register new tools.

---

## Status

Implementation complete. All three modes are functional with 83 tests covering schemas, storage, session management, action generation, recording, element matching, assertions, and script execution. Gated behind `MOBILE_TESTING=1` env var.
