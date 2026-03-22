import crypto from "node:crypto";

import { MonkeyConfig, TestReport, TapParams, DoubleTapParams, LongPressParams, SwipeParams, SendKeysParams, PressButtonParams } from "../schemas";
import { Robot, Button } from "../../robot";
import { TestStore } from "../store";
import { SessionManager } from "../session";
import { MonkeyActionGenerator, GeneratedAction } from "./action-generator";
import { CrashDetector } from "./crash-detector";
import { RecordingRobot } from "../recording-robot";

export interface MonkeyRunState {
	reportId: string;
	sessionId: string;
	running: boolean;
	stopping: boolean;
}

export class MonkeyRunner {
	private activeRuns = new Map<string, MonkeyRunState>();

	constructor(
		private store: TestStore,
		private sessionManager: SessionManager,
	) {}

	async start(opts: {
		deviceId: string;
		platform: "android" | "ios";
		robot: Robot;
		appPackage?: string;
		config: MonkeyConfig;
		crashDetector?: CrashDetector;
	}): Promise<MonkeyRunState> {
		const existing = this.activeRuns.get(opts.deviceId);
		if (existing?.running) {
			throw new Error(`Monkey test already running on device "${opts.deviceId}"`);
		}

		const session = await this.sessionManager.startSession({
			mode: "monkey",
			deviceId: opts.deviceId,
			platform: opts.platform,
			robot: opts.robot,
			appPackage: opts.appPackage,
		});

		const reportId = crypto.randomUUID();
		const report: TestReport = {
			id: reportId,
			mode: "monkey",
			deviceId: opts.deviceId,
			platform: opts.platform,
			appPackage: opts.appPackage,
			startedAt: Date.now(),
			status: "running",
			stepsExecuted: 0,
			stepsPassed: 0,
			stepsFailed: 0,
			errors: [],
		};
		this.store.createReport(report);

		const state: MonkeyRunState = {
			reportId,
			sessionId: session.id,
			running: true,
			stopping: false,
		};
		this.activeRuns.set(opts.deviceId, state);

		const recordingRobot = new RecordingRobot(
			opts.robot, session.id, this.store,
			opts.config.captureScreenshots !== false,
		);
		const generator = new MonkeyActionGenerator(opts.config);
		const screenSize = session.screenSize!;
		const config = opts.config;
		const store = this.store;
		const sessionManager = this.sessionManager;
		const crashDetector = opts.crashDetector;

		// Fire-and-forget async loop
		const runLoop = async () => {
			let actionsExecuted = 0;
			let stepsPassed = 0;
			let stepsFailed = 0;
			const startTime = Date.now();

			try {
				while (state.running && !state.stopping) {
					if (config.maxActions && actionsExecuted >= config.maxActions) {break;}
					if (config.maxDurationMs && (Date.now() - startTime) >= config.maxDurationMs) {break;}

					let elements: import("../../robot").ScreenElement[] = [];
					try {
						elements = await opts.robot.getElementsOnScreen();
					} catch {
						// Element fetch may fail; continue with empty list
					}

					const generated = generator.generate(elements, screenSize);

					try {
						await executeAction(recordingRobot, generated);
						stepsPassed++;
					} catch (e: any) {
						stepsFailed++;
						store.addReportError(reportId, {
							stepNumber: actionsExecuted + 1,
							actionType: generated.type,
							message: e.message,
							timestamp: Date.now(),
						});
					}

					// Check for crashes
					if (crashDetector) {
						const crash = crashDetector.check(opts.appPackage);
						if (crash) {
							stepsFailed++;
							store.addReportError(reportId, {
								stepNumber: actionsExecuted + 1,
								actionType: generated.type,
								message: `${crash.type}: ${crash.message}`,
								timestamp: crash.timestamp,
							});

							// Try to recover
							if (opts.appPackage) {
								try {
									await opts.robot.launchApp(opts.appPackage);
								} catch {
									// Recovery failed, continue anyway
								}
							}
							crashDetector.clearState();
						}
					}

					actionsExecuted++;
					sessionManager.incrementActionCount(session.id);
					store.updateReport(reportId, {
						stepsExecuted: actionsExecuted,
						stepsPassed,
						stepsFailed,
					});

					// Small delay between actions
					await new Promise(r => setTimeout(r, 300));
				}
			} catch (e: any) {
				store.addReportError(reportId, {
					stepNumber: actionsExecuted + 1,
					actionType: "tap",
					message: `Fatal error: ${e.message}`,
					timestamp: Date.now(),
				});
			}

			// Finalize
			state.running = false;
			try { sessionManager.endSession(session.id); } catch { /* already ended */ }
			store.updateReport(reportId, {
				status: state.stopping ? "stopped" : (stepsFailed > 0 ? "failed" : "passed"),
				endedAt: Date.now(),
				stepsExecuted: actionsExecuted,
				stepsPassed,
				stepsFailed,
			});
		};

		runLoop().catch(() => {
			state.running = false;
		});

		return state;
	}

	stop(deviceId: string): TestReport | undefined {
		const state = this.activeRuns.get(deviceId);
		if (!state) {return undefined;}

		state.stopping = true;
		return this.store.getReport(state.reportId);
	}

	getStatus(deviceId: string): MonkeyRunState | undefined {
		return this.activeRuns.get(deviceId);
	}

	getReport(reportId: string): TestReport | undefined {
		return this.store.getReport(reportId);
	}
}

async function executeAction(robot: Robot, action: GeneratedAction): Promise<void> {
	switch (action.type) {
		case "tap": {
			const p = action.params as TapParams;
			await robot.tap(p.x, p.y);
			break;
		}
		case "doubleTap": {
			const p = action.params as DoubleTapParams;
			await robot.doubleTap(p.x, p.y);
			break;
		}
		case "longPress": {
			const p = action.params as LongPressParams;
			await robot.longPress(p.x, p.y, p.duration);
			break;
		}
		case "swipe": {
			const p = action.params as SwipeParams;
			if (p.x !== undefined && p.y !== undefined) {
				await robot.swipeFromCoordinate(p.x, p.y, p.direction, p.distance);
			} else {
				await robot.swipe(p.direction);
			}
			break;
		}
		case "sendKeys": {
			const p = action.params as SendKeysParams;
			await robot.sendKeys(p.text);
			break;
		}
		case "pressButton": {
			const p = action.params as PressButtonParams;
			await robot.pressButton(p.button as Button);
			break;
		}
	}
}
