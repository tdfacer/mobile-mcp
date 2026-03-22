import crypto from "node:crypto";

import {
	TestAction, TestScript, TestScriptStep, ElementMatcher,
	TapParams, DoubleTapParams, LongPressParams,
} from "./schemas";
import { TestStore } from "./store";
import { ScreenElement, ScreenSize } from "../robot";

export class ScriptBuilder {
	constructor(private store: TestStore) {}

	buildFromSession(opts: {
		sessionId: string;
		name: string;
		description?: string;
		platform: "android" | "ios";
		appPackage?: string;
		tags?: string[];
		screenSize?: ScreenSize;
	}): TestScript {
		const actions = this.store.getActionsForSession(opts.sessionId);
		if (actions.length === 0) {
			throw new Error(`No actions found for session "${opts.sessionId}"`);
		}

		const scriptId = crypto.randomUUID();
		const now = Date.now();

		const script: TestScript = {
			id: scriptId,
			name: opts.name,
			description: opts.description ?? "",
			platform: opts.platform,
			appPackage: opts.appPackage,
			tags: opts.tags ?? [],
			createdAt: now,
			updatedAt: now,
		};
		this.store.createScript(script);

		for (let i = 0; i < actions.length; i++) {
			const action = actions[i];
			const step: TestScriptStep = {
				id: crypto.randomUUID(),
				scriptId,
				sequenceNumber: i + 1,
				actionType: action.type,
				params: action.params,
				targetElement: this.buildElementMatcher(action, opts.screenSize),
				assertions: [],
				timeoutMs: Math.max(5000, action.durationMs * 3),
			};
			this.store.createStep(step);
		}

		return script;
	}

	private buildElementMatcher(action: TestAction, screenSize?: ScreenSize): ElementMatcher | undefined {
		// Only build matchers for coordinate-based actions
		if (action.type !== "tap" && action.type !== "doubleTap" && action.type !== "longPress") {
			return undefined;
		}

		const params = action.params as TapParams | DoubleTapParams | LongPressParams;
		const x = params.x;
		const y = params.y;

		if (!action.elementsBefore || action.elementsBefore.length === 0) {
			return this.buildRelativeMatcher(x, y, screenSize);
		}

		// Find the element at the tapped coordinates
		const element = this.findElementAtPoint(action.elementsBefore, x, y);
		if (!element) {
			return this.buildRelativeMatcher(x, y, screenSize);
		}

		const matcher: ElementMatcher = {};

		if (element.identifier) {matcher.identifier = element.identifier;}
		if (element.label) {matcher.label = element.label;}
		if (element.text) {matcher.text = element.text;}
		if (element.type) {matcher.type = element.type;}
		if (element.name) {matcher.name = element.name;}

		// Always include relative coordinates as fallback
		if (screenSize && screenSize.width > 0 && screenSize.height > 0) {
			matcher.relativeX = x / screenSize.width;
			matcher.relativeY = y / screenSize.height;
		}

		return matcher;
	}

	private buildRelativeMatcher(x: number, y: number, screenSize?: ScreenSize): ElementMatcher | undefined {
		if (!screenSize || screenSize.width === 0 || screenSize.height === 0) {return undefined;}
		return {
			relativeX: x / screenSize.width,
			relativeY: y / screenSize.height,
		};
	}

	private findElementAtPoint(elements: ScreenElement[], x: number, y: number): ScreenElement | undefined {
		// Find the smallest element that contains the point
		let best: ScreenElement | undefined;
		let bestArea = Infinity;

		for (const el of elements) {
			const r = el.rect;
			if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
				const area = r.width * r.height;
				if (area < bestArea) {
					best = el;
					bestArea = area;
				}
			}
		}

		return best;
	}
}
