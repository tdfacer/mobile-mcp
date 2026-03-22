import {
	MonkeyConfig, MonkeyActionKind, DEFAULT_MONKEY_WEIGHTS,
	ActionType, ActionParams,
} from "../schemas";
import { ScreenElement, ScreenSize } from "../../robot";

export interface GeneratedAction {
	type: ActionType;
	params: ActionParams;
	kind: MonkeyActionKind;
}

// Mulberry32 seeded PRNG — deterministic, fast
function mulberry32(seed: number): () => number {
	let s = seed | 0;
	return () => {
		s = (s + 0x6D2B79F5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const RANDOM_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SWIPE_DIRECTIONS = ["up", "down", "left", "right"] as const;

// Minimum Y to avoid tapping the status bar
const STATUS_BAR_MARGIN = 80;

export class MonkeyActionGenerator {
	private weights: Record<MonkeyActionKind, number>;
	private rng: () => number;

	constructor(config: MonkeyConfig) {
		this.weights = { ...DEFAULT_MONKEY_WEIGHTS, ...config.actionWeights };
		this.rng = mulberry32(config.seed ?? Date.now());
	}

	generate(elements: ScreenElement[], screenSize: ScreenSize): GeneratedAction {
		const kind = this.pickWeightedKind(elements);

		switch (kind) {
			case "tapElement":
				return this.generateTapElement(elements);
			case "tapRandom":
				return this.generateTapRandom(screenSize);
			case "swipe":
				return this.generateSwipe(screenSize);
			case "pressBack":
				return { type: "pressButton", params: { button: "BACK" }, kind };
			case "typeText":
				return this.generateTypeText();
			case "longPress":
				return this.generateLongPress(elements, screenSize);
		}
	}

	private pickWeightedKind(elements: ScreenElement[]): MonkeyActionKind {
		const weights = { ...this.weights };

		// Can't tap elements if there are none
		if (elements.length === 0) {
			weights.tapElement = 0;
			weights.longPress = Math.max(weights.longPress, weights.tapElement);
		}

		// Only type text if a text field is focused
		const hasFocusedTextField = elements.some(
			e => e.focused && (e.type.includes("Text") || e.type.includes("Edit"))
		);
		if (!hasFocusedTextField) {
			weights.typeText = 0;
		}

		const total = Object.values(weights).reduce((a, b) => a + b, 0);
		if (total === 0) {
			return "tapRandom"; // fallback
		}

		let r = this.rng() * total;
		for (const [kind, weight] of Object.entries(weights)) {
			r -= weight;
			if (r <= 0) {return kind as MonkeyActionKind;}
		}
		return "tapRandom";
	}

	private generateTapElement(elements: ScreenElement[]): GeneratedAction {
		const idx = Math.floor(this.rng() * elements.length);
		const el = elements[idx];
		const x = Math.round(el.rect.x + el.rect.width / 2);
		const y = Math.round(el.rect.y + el.rect.height / 2);
		return { type: "tap", params: { x, y }, kind: "tapElement" };
	}

	private generateTapRandom(screenSize: ScreenSize): GeneratedAction {
		const x = Math.round(this.rng() * screenSize.width);
		const y = Math.round(STATUS_BAR_MARGIN + this.rng() * (screenSize.height - STATUS_BAR_MARGIN * 2));
		return { type: "tap", params: { x, y }, kind: "tapRandom" };
	}

	private generateSwipe(screenSize: ScreenSize): GeneratedAction {
		const direction = SWIPE_DIRECTIONS[Math.floor(this.rng() * SWIPE_DIRECTIONS.length)];
		return {
			type: "swipe",
			params: { direction },
			kind: "swipe",
		};
	}

	private generateTypeText(): GeneratedAction {
		const len = 5 + Math.floor(this.rng() * 16); // 5-20 chars
		let text = "";
		for (let i = 0; i < len; i++) {
			text += RANDOM_CHARS[Math.floor(this.rng() * RANDOM_CHARS.length)];
		}
		return { type: "sendKeys", params: { text }, kind: "typeText" };
	}

	private generateLongPress(elements: ScreenElement[], screenSize: ScreenSize): GeneratedAction {
		const duration = 500 + Math.floor(this.rng() * 1500); // 500-2000ms
		let x: number, y: number;

		if (elements.length > 0 && this.rng() > 0.3) {
			const idx = Math.floor(this.rng() * elements.length);
			const el = elements[idx];
			x = Math.round(el.rect.x + el.rect.width / 2);
			y = Math.round(el.rect.y + el.rect.height / 2);
		} else {
			x = Math.round(this.rng() * screenSize.width);
			y = Math.round(STATUS_BAR_MARGIN + this.rng() * (screenSize.height - STATUS_BAR_MARGIN * 2));
		}

		return { type: "longPress", params: { x, y, duration }, kind: "longPress" };
	}
}
