# Testing Automation — Usage Guide

> Requires `MOBILE_TESTING=1` environment variable to be set when starting the MCP server.

This guide shows how to use the 24 testing MCP tools. All examples assume you have a connected Android device. Replace `device` values with your actual device identifier (e.g. `emulator-5554`).

---

## Quick Start

Add the testing-enabled server to your MCP client config (e.g. `claude_desktop_config.json`, `.mcp.json`, Cursor settings, or any MCP-compatible agent).

### Published package

If using the published npm package:

```json
{
  "mcpServers": {
    "mobile-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@mobilenext/mobile-mcp@latest"
      ],
      "env": {
        "MOBILE_TESTING": "1"
      }
    }
  }
}
```

### Local development build

If testing local changes (e.g. from a clone of this repo), point directly at the built output. Run `npm run build` first, then:

```json
{
  "mcpServers": {
    "mobile-mcp": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/mobile-mcp/lib/index.js",
        "--stdio"
      ],
      "env": {
        "MOBILE_TESTING": "1"
      }
    }
  }
}
```

Replace `/path/to/mobile-mcp` with the actual path to your local clone. Rebuild with `npm run build` after any source changes.

### Command line

```
# Published
MOBILE_TESTING=1 npx @mobilenext/mobile-mcp@latest --stdio

# Local
MOBILE_TESTING=1 node /path/to/mobile-mcp/lib/index.js --stdio
```

Data is stored in `~/.mobile-mcp/testing.db` (SQLite).

### Agent behavior

The server provides MCP-level instructions that guide connected agents to prefer the accessibility tree (`mobile_list_elements_on_screen`) over screenshots (`mobile_take_screenshot`). The elements list is significantly more reliable for identifying and interacting with UI elements. Screenshots should be used only as a fallback for visual context that elements can't provide (layout, images, non-labeled content).

When building agent prompts that use this server, include the app's package name and reinforce the use of accessibility identifiers (e.g. `resource-id` on Android, `accessibilityIdentifier` on iOS) for reliable element targeting.

---

## 1. Monkey Testing

Monkey testing performs random actions on your app to find crashes, ANRs, and errors. Tests run in the background.

### Start a monkey test

```json
// mobile_monkey_start
{
  "device": "emulator-5554",
  "appPackage": "com.example.myapp",
  "maxActions": 500,
  "maxDurationMs": 120000,
  "seed": 42
}
// Returns: { "reportId": "...", "sessionId": "...", "status": "running" }
```

| Parameter | Required | Description |
|---|---|---|
| `device` | Yes | Device identifier |
| `appPackage` | No | App package name. If set, the app is relaunched after crashes. |
| `maxActions` | No | Stop after this many actions |
| `maxDurationMs` | No | Stop after this many milliseconds |
| `seed` | No | Random seed for reproducible runs (same seed + same screen states = same actions) |

### Check progress

```json
// mobile_monkey_status
{ "device": "emulator-5554" }
// Returns: { "reportId": "...", "running": true, "stepsExecuted": 137, "stepsPassed": 135, "stepsFailed": 2 }
```

### Stop and get results

```json
// mobile_monkey_stop
{ "device": "emulator-5554" }
// Returns: full report with status, steps, errors
```

### Retrieve a past report

```json
// mobile_monkey_report
{ "reportId": "abc-123" }
// Returns: full report including error details
```

### Typical workflow

1. `mobile_monkey_start` — kick off the test
2. `mobile_monkey_status` — poll periodically to check progress
3. `mobile_monkey_stop` — stop when satisfied (or let it hit limits)
4. `mobile_monkey_report` — review the full report with crash details

---

## 2. Recording (Data Collection)

Recording mode captures every action you perform through the normal `mobile_*` tools. You use the device as usual — the system transparently records everything in the background.

### Start recording

```json
// mobile_recording_start
{
  "device": "emulator-5554",
  "taskDescription": "Login and navigate to settings",
  "appPackage": "com.example.myapp"
}
// Returns: { "sessionId": "...", "status": "recording" }
```

### Perform actions normally

While recording is active, use any `mobile_*` tool as you normally would:

```json
// mobile_tap
{ "device": "emulator-5554", "x": 540, "y": 960 }

// mobile_type
{ "device": "emulator-5554", "text": "user@example.com" }

// mobile_swipe
{ "device": "emulator-5554", "direction": "up" }
```

Every action is captured with before/after element state.

### Stop recording

```json
// mobile_recording_stop
{ "device": "emulator-5554" }
// Returns: { "sessionId": "...", "actionCount": 12, "durationMs": 45000 }
```

### Build a replayable script from the recording

```json
// mobile_recording_build_script
{
  "sessionId": "the-session-id-from-start",
  "name": "Login Flow",
  "description": "Logs in and navigates to settings page",
  "tags": "login, settings, smoke"
}
// Returns: { "scriptId": "...", "name": "Login Flow", "stepCount": 12 }
```

The script builder automatically creates `ElementMatcher` entries for each step, so playback can find elements by their accessibility attributes instead of relying on exact coordinates.

### Typical workflow: record, build, run

Recording doesn't directly produce a runnable script — you need to build one from the session, then run it. The full pipeline:

1. `mobile_recording_start` — begin recording, returns a `sessionId`
2. Use `mobile_tap`, `mobile_type`, `mobile_swipe`, etc. as normal
3. `mobile_recording_stop` — finish recording
4. `mobile_recording_build_script` — convert the `sessionId` into a reusable `scriptId`
5. (Optional) `mobile_test_add_assertion` — add assertions to verify expected state at specific steps
6. `mobile_test_run_script` — run the script on any device, returns a `reportId`
7. `mobile_test_get_report` — check results

The script is saved permanently. You can run it repeatedly on different devices without re-recording.

---

## 3. Procedural Testing (Script Replay)

Procedural testing replays a saved script, re-targeting elements by their attributes (not raw coordinates) and verifying assertions after each step.

### Run a script

```json
// mobile_test_run_script
{
  "device": "emulator-5554",
  "scriptId": "script-id-from-build"
}
// Returns: { "reportId": "...", "status": "running", "stepCount": 12 }
```

The executor runs in the background. For each step it:
1. Waits for any `waitForElement` condition to be satisfied (if set)
2. Finds the target element using a 7-level priority chain (identifier > label+type > text+type > text > label > name > relative coords)
3. Executes the action
4. Waits `delayAfterMs` for the UI to settle
5. Checks for crashes, ANRs, and error dialogs (via ADB on Android)
6. Runs any assertions attached to the step

Crash detection runs automatically on every step — if the app crashes or an error dialog appears, execution stops immediately and the report captures the error details. This uses the same `CrashDetector` as monkey testing (checks foreground app, error dialogs via `dumpsys`, and logcat for fatal exceptions).

### Check execution progress

```json
// mobile_test_run_status
{ "device": "emulator-5554" }
// Returns: { "reportId": "...", "running": true, "currentStep": 5, "stepsExecuted": 4, "stepsPassed": 4, "stepsFailed": 0 }
```

### Stop a running test

```json
// mobile_test_stop_script
{ "device": "emulator-5554" }
// Returns: { "reportId": "...", "stopping": true }
```

### Get the full report

```json
// mobile_test_get_report
{ "reportId": "report-id" }
// Returns: full report with per-step results, errors, timestamps
```

### List all reports

```json
// mobile_test_list_reports
{ "limit": 10 }
// Returns: { "reports": [...] }
```

---

## 4. Script Management

### List all scripts

```json
// mobile_script_list
{}
// Returns: { "scripts": [{ "id": "...", "name": "Login Flow", "platform": "android", ... }] }
```

### View a script with all steps

```json
// mobile_script_get
{ "scriptId": "script-id" }
// Returns: { "script": {...}, "steps": [{...}, ...] }
```

### Delete a script

```json
// mobile_script_delete
{ "scriptId": "script-id" }
// Returns: { "deleted": "script-id" }
```

### Export a script as portable JSON

```json
// mobile_script_export
{ "scriptId": "script-id" }
// Returns: { "version": 1, "script": {...}, "steps": [...] }
```

### Import a script from JSON

Restores a script previously exported with `mobile_script_export`. The script gets a new ID so it won't conflict with existing scripts.

```json
// mobile_script_import
{ "json": "{\"version\":1,\"script\":{...},\"steps\":[...]}" }
// Returns: { "scriptId": "new-id", "name": "Login Flow", "stepCount": 12 }
```

This enables sharing scripts between machines, backing up test suites, and restoring from version control.

---

## 5. Script Step Editing

After building a script from a recording, you can modify individual steps without re-recording the entire flow.

### Delete a step

Removes a step and automatically renumbers the remaining steps.

```json
// mobile_script_delete_step
{ "scriptId": "script-id", "stepSequence": 3 }
// Returns: { "scriptId": "...", "deletedStep": 3, "remainingSteps": 11 }
```

### Move a step

Reorder a step to a different position. All steps are renumbered automatically.

```json
// mobile_script_move_step
{ "scriptId": "script-id", "fromSequence": 5, "toSequence": 2 }
// Returns: { "scriptId": "...", "movedStep": 5, "newPosition": 2, "totalSteps": 12 }
```

### Update step parameters

Change a step's action parameters (e.g. tap coordinates, input text), timeout, or delay without deleting and recreating it.

```json
// mobile_script_update_step
{
  "scriptId": "script-id",
  "stepSequence": 3,
  "params": "{\"x\": 200, \"y\": 500}",
  "timeoutMs": 10000,
  "delayAfterMs": 2000
}
// Returns: { "scriptId": "...", "stepSequence": 3, "updated": true }
```

All fields except `scriptId` and `stepSequence` are optional — only specify what you want to change.

---

## 6. Adding Assertions

Assertions verify screen state after a step executes. Add them to a script before running it.

### Add an assertion to a step

```json
// mobile_test_add_assertion
{
  "scriptId": "script-id",
  "stepSequence": 3,
  "assertionType": "screenContainsText",
  "params": "{\"text\": \"Welcome back\"}",
  "soft": false
}
// Returns: { "scriptId": "...", "stepSequence": 3, "assertionCount": 1 }
```

| Parameter | Required | Description |
|---|---|---|
| `scriptId` | Yes | The script to modify |
| `stepSequence` | Yes | Step number (1-based) to attach the assertion to |
| `assertionType` | Yes | One of the four types below |
| `params` | Yes | JSON string with type-specific parameters |
| `soft` | No | If `true`, failure logs a warning but doesn't stop execution. Default: `false` |

### Assertion types

**`elementExists`** — Verify an element is present on screen.
```json
{ "params": "{\"identifier\": \"login_btn\"}" }
{ "params": "{\"text\": \"Submit\"}" }
```

**`elementHasText`** — Verify an element contains specific text.
```json
{ "params": "{\"identifier\": \"welcome_label\", \"text\": \"Welcome back\"}" }
```

**`screenContainsText`** — Verify any element on screen contains the text.
```json
{ "params": "{\"text\": \"Settings\"}" }
```

**`noErrorDialog`** — Verify no crash/error dialogs are showing. Checks for common patterns like "has stopped", "keeps stopping", "unfortunately", "not responding".
```json
{ "params": "{}" }
```

### Hard vs soft assertions

- **Hard** (`soft: false`, default): Stops script execution on failure. The step and report are marked as failed.
- **Soft** (`soft: true`): Logs a warning but continues execution. The step is still marked as passed.

---

## 7. Wait-for-Element

Fixed delays work for predictable transitions, but some screens take variable time to load (network requests, animations, app startup). `mobile_test_add_wait` attaches a wait-for-element condition to a step — the executor polls every 500ms until the element appears before executing the step's action.

### Add a wait condition

```json
// mobile_test_add_wait
{
  "scriptId": "script-id",
  "stepSequence": 3,
  "identifier": "search_results_list"
}
// Returns: { "scriptId": "...", "stepSequence": 3, "waitForElement": { "identifier": "search_results_list" } }
```

You can match by any combination of:

| Parameter | Description |
|---|---|
| `identifier` | Accessibility identifier (`resource-id` on Android) |
| `text` | Visible text content |
| `label` | Accessibility label (`content-desc` on Android) |
| `type` | Element type (e.g. `Button`, `TextField`). Combines with `text` or `label` for precise matching. |
| `timeoutMs` | Override the step's timeout for this wait (optional) |

At least one of `identifier`, `text`, or `label` is required.

### When to use wait-for-element vs delays

- **Fixed delay** (`delayAfterMs`): Use for predictable, short transitions — button animations, keyboard appearance, tab switches.
- **Wait-for-element**: Use when the next screen depends on something unpredictable — network responses, app launches, search results loading, content rendering.

### Example: wait for search results before tapping

```
mobile_test_add_wait  { scriptId: "xyz", stepSequence: 4, text: "Search results", timeoutMs: 15000 }
```

Step 4 will now wait up to 15 seconds for an element containing "Search results" before executing. If it doesn't appear, the step fails with a timeout error.

---

## 8. Step Delays

When replaying scripts, each step includes a delay after execution to give the UI time to respond (animations, network loads, screen transitions). Smart defaults are set automatically based on action type when scripts are built from recordings:

| Action Type | Default Delay |
|---|---|
| `tap` | 1000ms |
| `doubleTap` | 1000ms |
| `longPress` | 1000ms |
| `swipe` | 800ms |
| `sendKeys` | 500ms |
| `pressButton` | 800ms |
| `launchApp` | 2000ms |
| `terminateApp` | 1000ms |
| `openUrl` | 2000ms |
| `setOrientation` | 1000ms |

### Override a step's delay

```json
// mobile_test_set_step_delay
{
  "scriptId": "script-id",
  "stepSequence": 3,
  "delayMs": 3000
}
// Returns: { "scriptId": "...", "stepSequence": 3, "delayMs": 3000, "stepsUpdated": 1 }
```

### Set delay for all steps at once

Use `stepSequence: 0` to apply the same delay to every step:

```json
// mobile_test_set_step_delay
{
  "scriptId": "script-id",
  "stepSequence": 0,
  "delayMs": 2000
}
// Returns: { "scriptId": "...", "stepSequence": "all", "delayMs": 2000, "stepsUpdated": 12 }
```

Set `delayMs: 0` to disable delays entirely (useful for speed testing).

---

## End-to-End Example

Here's a complete workflow: record a login flow, add assertions, then replay it.

```
1. Start recording
   mobile_recording_start  { device: "emulator-5554", appPackage: "com.example.app" }
   -> sessionId: "sess-abc"

2. Perform the login flow using normal tools
   mobile_tap       { device: "emulator-5554", x: 540, y: 400 }   // tap email field
   mobile_type      { device: "emulator-5554", text: "user@test.com" }
   mobile_tap       { device: "emulator-5554", x: 540, y: 500 }   // tap password field
   mobile_type      { device: "emulator-5554", text: "password123" }
   mobile_tap       { device: "emulator-5554", x: 540, y: 700 }   // tap login button

3. Stop recording
   mobile_recording_stop  { device: "emulator-5554" }
   -> actionCount: 5

4. Build a replayable script
   mobile_recording_build_script  { sessionId: "sess-abc", name: "Login", tags: "auth,smoke" }
   -> scriptId: "script-xyz", stepCount: 5

5. Add assertions
   mobile_test_add_assertion  { scriptId: "script-xyz", stepSequence: 5, assertionType: "screenContainsText", params: "{\"text\": \"Welcome\"}" }
   mobile_test_add_assertion  { scriptId: "script-xyz", stepSequence: 5, assertionType: "noErrorDialog", params: "{}" }

6. Run the script on a different device or after app changes
   mobile_test_run_script  { device: "emulator-5556", scriptId: "script-xyz" }
   -> reportId: "report-123"

7. Check results
   mobile_test_get_report  { reportId: "report-123" }
   -> { status: "passed", stepsExecuted: 5, stepsPassed: 5, stepsFailed: 0 }
```

---

## Tool Reference (24 tools)

| Tool | Category | Description |
|---|---|---|
| `mobile_monkey_start` | Monkey | Start random action testing |
| `mobile_monkey_status` | Monkey | Check monkey test progress |
| `mobile_monkey_stop` | Monkey | Stop and get final report |
| `mobile_monkey_report` | Monkey | Retrieve a past report by ID |
| `mobile_recording_start` | Recording | Begin capturing actions |
| `mobile_recording_stop` | Recording | Stop capturing, get summary |
| `mobile_recording_build_script` | Recording | Convert recording to script |
| `mobile_script_list` | Scripts | List all saved scripts |
| `mobile_script_get` | Scripts | View script with steps |
| `mobile_script_delete` | Scripts | Delete a script |
| `mobile_script_export` | Scripts | Export script as portable JSON |
| `mobile_script_import` | Scripts | Import script from JSON |
| `mobile_script_delete_step` | Editing | Delete a step from a script |
| `mobile_script_move_step` | Editing | Reorder a step to a new position |
| `mobile_script_update_step` | Editing | Update step params, timeout, or delay |
| `mobile_test_run_script` | Procedural | Run a script (with crash detection) |
| `mobile_test_run_status` | Procedural | Check script execution progress |
| `mobile_test_stop_script` | Procedural | Stop a running script |
| `mobile_test_get_report` | Procedural | Get full test report |
| `mobile_test_list_reports` | Procedural | List all test reports |
| `mobile_test_add_assertion` | Procedural | Add assertion to a script step |
| `mobile_test_set_step_delay` | Procedural | Set delay after a step (or all steps) |
| `mobile_test_add_wait` | Procedural | Wait for element before step executes |
