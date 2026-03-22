import { execFileSync } from "node:child_process";
import { getAdbPath } from "../../android";

export interface CrashInfo {
	type: "crash" | "anr" | "error_dialog";
	packageName?: string;
	message: string;
	timestamp: number;
}

export interface CrashDetector {
	check(appPackage?: string): CrashInfo | null;
	clearState(): void;
}

const CRASH_DIALOG_PATTERNS = [
	"Application Error",
	"Application Not Responding",
	"has stopped",
	"keeps stopping",
	"isn't responding",
	"not responding",
];

export class AndroidCrashDetector implements CrashDetector {
	private lastCheckedTimestamp: number;

	constructor(private deviceId: string) {
		this.lastCheckedTimestamp = Date.now();
	}

	check(appPackage?: string): CrashInfo | null {
		const now = Date.now();

		// Check if app is still in foreground
		if (appPackage) {
			const foreground = this.checkForegroundApp();
			if (foreground && !foreground.includes(appPackage)) {
				// Check if it's a crash/error dialog
				const dialogCrash = this.checkErrorDialog();
				if (dialogCrash) {return dialogCrash;}

				this.lastCheckedTimestamp = now;
				return {
					type: "crash",
					packageName: appPackage,
					message: `App ${appPackage} is no longer in foreground (current: ${foreground})`,
					timestamp: now,
				};
			}
		}

		// Check for error dialogs
		const dialogCrash = this.checkErrorDialog();
		if (dialogCrash) {
			this.lastCheckedTimestamp = now;
			return dialogCrash;
		}

		// Check logcat for fatal exceptions
		const logcatCrash = this.checkLogcat(appPackage);
		if (logcatCrash) {
			this.lastCheckedTimestamp = now;
			return logcatCrash;
		}

		this.lastCheckedTimestamp = now;
		return null;
	}

	clearState(): void {
		this.lastCheckedTimestamp = Date.now();
	}

	private adb(...args: string[]): string {
		try {
			return execFileSync(getAdbPath(), ["-s", this.deviceId, ...args], {
				timeout: 5000,
				maxBuffer: 1024 * 1024,
			}).toString();
		} catch {
			return "";
		}
	}

	private checkForegroundApp(): string | null {
		const output = this.adb("shell", "dumpsys", "activity", "activities");
		const match = output.match(/mResumedActivity.*?([a-zA-Z0-9_.]+)\//);
		return match ? match[1] : null;
	}

	private checkErrorDialog(): CrashInfo | null {
		const output = this.adb("shell", "dumpsys", "window");
		const focusMatch = output.match(/mCurrentFocus.*?([\w./ ]+)/);
		if (!focusMatch) {return null;}

		const currentFocus = focusMatch[1];
		for (const pattern of CRASH_DIALOG_PATTERNS) {
			if (currentFocus.includes(pattern)) {
				return {
					type: "error_dialog",
					message: `Error dialog detected: ${currentFocus}`,
					timestamp: Date.now(),
				};
			}
		}
		return null;
	}

	private checkLogcat(appPackage?: string): CrashInfo | null {
		// Get logcat entries since last check (approximate with -t seconds)
		const secondsAgo = Math.max(1, Math.ceil((Date.now() - this.lastCheckedTimestamp) / 1000));
		const output = this.adb("logcat", "-d", "-t", `${secondsAgo}s`, "*:E");

		if (output.includes("FATAL EXCEPTION")) {
			const lines = output.split("\n");
			const fatalLine = lines.find(l => l.includes("FATAL EXCEPTION")) ?? "FATAL EXCEPTION detected";
			return {
				type: "crash",
				packageName: appPackage,
				message: fatalLine.trim(),
				timestamp: Date.now(),
			};
		}

		if (output.includes("ANR in")) {
			const anrLine = output.split("\n").find(l => l.includes("ANR in")) ?? "ANR detected";
			return {
				type: "anr",
				packageName: appPackage,
				message: anrLine.trim(),
				timestamp: Date.now(),
			};
		}

		return null;
	}
}
