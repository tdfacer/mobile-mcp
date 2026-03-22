import crypto from "node:crypto";

import {
	Robot, ScreenElement, ScreenSize, InstalledApp,
	SwipeDirection, Button, Orientation,
} from "../robot";
import { TestAction, ActionType, ActionParams } from "./schemas";
import { TestStore } from "./store";

export class RecordingRobot implements Robot {
	private sequenceNumber = 0;

	constructor(
		private inner: Robot,
		private sessionId: string,
		private store: TestStore,
		private captureElements: boolean = true,
	) {}

	// --- Recorded (mutating) methods ---

	async tap(x: number, y: number): Promise<void> {
		await this.recordAction("tap", { x, y }, () => this.inner.tap(x, y));
	}

	async doubleTap(x: number, y: number): Promise<void> {
		await this.recordAction("doubleTap", { x, y }, () => this.inner.doubleTap(x, y));
	}

	async longPress(x: number, y: number, duration: number): Promise<void> {
		await this.recordAction("longPress", { x, y, duration }, () => this.inner.longPress(x, y, duration));
	}

	async swipe(direction: SwipeDirection): Promise<void> {
		await this.recordAction("swipe", { direction }, () => this.inner.swipe(direction));
	}

	async swipeFromCoordinate(x: number, y: number, direction: SwipeDirection, distance?: number): Promise<void> {
		await this.recordAction("swipe", { direction, x, y, distance }, () => this.inner.swipeFromCoordinate(x, y, direction, distance));
	}

	async sendKeys(text: string): Promise<void> {
		await this.recordAction("sendKeys", { text }, () => this.inner.sendKeys(text));
	}

	async pressButton(button: Button): Promise<void> {
		await this.recordAction("pressButton", { button }, () => this.inner.pressButton(button));
	}

	async launchApp(packageName: string, locale?: string): Promise<void> {
		await this.recordAction("launchApp", { packageName, locale }, () => this.inner.launchApp(packageName, locale));
	}

	async terminateApp(packageName: string): Promise<void> {
		await this.recordAction("terminateApp", { packageName }, () => this.inner.terminateApp(packageName));
	}

	async openUrl(url: string): Promise<void> {
		await this.recordAction("openUrl", { url }, () => this.inner.openUrl(url));
	}

	async setOrientation(orientation: Orientation): Promise<void> {
		await this.recordAction("setOrientation", { orientation }, () => this.inner.setOrientation(orientation));
	}

	// --- Pass-through (read-only) methods ---

	async getScreenSize(): Promise<ScreenSize> {
		return this.inner.getScreenSize();
	}

	async getScreenshot(): Promise<Buffer> {
		return this.inner.getScreenshot();
	}

	async getElementsOnScreen(): Promise<ScreenElement[]> {
		return this.inner.getElementsOnScreen();
	}

	async listApps(): Promise<InstalledApp[]> {
		return this.inner.listApps();
	}

	async getOrientation(): Promise<Orientation> {
		return this.inner.getOrientation();
	}

	async installApp(path: string): Promise<void> {
		return this.inner.installApp(path);
	}

	async uninstallApp(bundleId: string): Promise<void> {
		return this.inner.uninstallApp(bundleId);
	}

	// --- Recording infrastructure ---

	private async recordAction(
		type: ActionType,
		params: ActionParams,
		execute: () => Promise<void>,
	): Promise<void> {
		this.sequenceNumber++;
		const seq = this.sequenceNumber;

		const elementsBefore = this.captureElements
			? await this.inner.getElementsOnScreen() : undefined;

		const start = Date.now();
		let result: "success" | "error" = "success";
		let error: string | undefined;

		try {
			await execute();
		} catch (e: any) {
			result = "error";
			error = e.message;
			throw e;
		} finally {
			const durationMs = Date.now() - start;
			const elementsAfter = this.captureElements
				? await this.inner.getElementsOnScreen() : undefined;

			const action: TestAction = {
				id: crypto.randomUUID(),
				sessionId: this.sessionId,
				sequenceNumber: seq,
				type,
				params,
				timestamp: start,
				durationMs,
				result,
				error,
				elementsBefore,
				elementsAfter,
			};

			this.store.createAction(action);
		}
	}
}
