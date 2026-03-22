# mobile-mcp

MCP server for controlling mobile devices (Android and iOS). Exposes device interaction primitives (tap, swipe, type, screenshot, element inspection, etc.) as MCP tools that AI agents can call.

## Project Structure

```
src/
  index.ts              # Entry point — SSE and stdio transport setup
  server.ts             # MCP tool registrations (all mobile_* tools defined here)
  robot.ts              # Core Robot interface + shared types (ScreenElement, Button, etc.)
  android.ts            # AndroidRobot — ADB-based, UIAutomator for elements
  ios.ts                # IosRobot — go-ios + WebDriverAgent
  webdriver-agent.ts    # WDA HTTP client (iOS element inspection, actions)
  mobile-device.ts      # MobileDevice — mobilecli wrapper (iOS simulators)
  mobilecli.ts          # CLI wrapper for @mobilenext/mobilecli binary
  iphone-simulator.ts   # Legacy simctl support
  image-utils.ts        # Screenshot resizing (sharp/sips/imagemagick)
  png.ts                # PNG dimension parser
  utils.ts              # Input validation helpers
  logger.ts             # File/console logging
  testing/              # Testing automation system
    schemas.ts          # Data model: TestAction, TestScript, TestReport, etc.
    store.ts            # TestStore interface
    sqlite-store.ts     # SQLite implementation (better-sqlite3, WAL mode)
    session.ts          # Session manager (lifecycle, dedup per device)
    recording-robot.ts  # RecordingRobot proxy (intercepts Robot calls)
    script-builder.ts   # Converts recorded sessions to replayable scripts
    tools.ts            # MCP tool registrations for all three modes
    monkey/
      action-generator.ts # Weighted random action selection (seeded PRNG)
      crash-detector.ts   # CrashDetector interface + AndroidCrashDetector
      runner.ts           # Background monkey test loop
    procedural/
      element-matcher.ts  # Priority-chain element matching (7 levels)
      assertions.ts       # Step assertion evaluation (4 types)
      executor.ts         # Script replay with re-targeting + assertions
```

## Key Concepts

- **Robot interface** (`src/robot.ts`): Abstract contract all device implementations fulfill. Methods: `tap`, `doubleTap`, `longPress`, `swipe`, `sendKeys`, `pressButton`, `getScreenshot`, `getElementsOnScreen`, `getScreenSize`, `listApps`, `launchApp`, `terminateApp`, `installApp`, `uninstallApp`, `openUrl`, `setOrientation`, `getOrientation`.
- **MCP tools** (`src/server.ts`): Registered via a `tool()` helper that wraps each Robot method with Zod validation, error handling, and PostHog telemetry.
- **Device resolution** (`getRobotFromDevice` in server.ts): Checks iOS devices → Android devices → iOS simulators via mobilecli. Returns the appropriate Robot implementation.

## Build & Test

```bash
npm run build     # tsc → lib/
npm test          # mocha + nyc, test/*.ts
npm run lint      # eslint
```

TypeScript config: CommonJS, ESNext target, strict mode. Output to `lib/`.

## Testing Automation

Gated behind `MOBILE_TESTING=1` env var. Design doc: `docs/testing-automation.md`. 83 tests cover all modules.

**Modes:**
1. **Monkey testing** — `mobile_monkey_start/status/stop/report` — Random interactions with crash/error detection (ADB-based), seeded PRNG for reproducibility, configurable weights and limits
2. **Data collection** — `mobile_recording_start/stop` + `mobile_recording_build_script` — RecordingRobot proxy transparently intercepts existing `mobile_*` tool calls, captures before/after element state, builds replayable scripts with ElementMatcher
3. **Procedural testing** — `mobile_test_run_script/run_status/stop_script/get_report/list_reports/add_assertion` — Replays scripts with smart element re-targeting (7-level priority chain) and 4 assertion types (elementExists, elementHasText, screenContainsText, noErrorDialog)

**Script management:** `mobile_script_list/get/delete/export`

**Architecture:** Android first. Platform-specific logic isolated behind interfaces (Robot, CrashDetector) so iOS can be added later. TestStore interface abstracts persistence — SQLite (better-sqlite3, WAL mode) ships first; REST API adapter can replace it.

**Data model** (`src/testing/schemas.ts`): ActionType maps 1:1 to Robot methods. TestAction records each interaction with before/after element state. TestScript + TestScriptStep for replayable sequences. TestReport for execution results. ElementMatcher uses priority chain (identifier → label+type → text+type → text → name → relative coords → raw coords).

## Workflow

- Track work with `bd` (beads). Run `bd ready` to find unblocked tasks. Update status with `bd update <id> --status in_progress` and `bd close <id>` when done.
- After completing a task or making significant changes, update this file and `docs/testing-automation.md` to reflect the current state. Keep the project structure tree, testing automation status, and any new conventions accurate.

## Conventions

- Tab indentation in TypeScript source
- MCP tools use Zod schemas with `.describe()` for param documentation
- Tools annotated with `readOnlyHint` / `destructiveHint`
- Prefer accessibility tree over screenshots for element identification
- When prompting agents to use this MCP, include app package name and instruct them to use accessibility tags rather than screenshots
