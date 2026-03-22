import { ElementMatcher } from "../schemas";
import { ScreenElement, ScreenSize } from "../../robot";

export interface MatchResult {
	element: ScreenElement;
	x: number;
	y: number;
	confidence: number;
}

function centerOf(rect: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
	return {
		x: Math.round(rect.x + rect.width / 2),
		y: Math.round(rect.y + rect.height / 2),
	};
}

export function findElement(
	matcher: ElementMatcher,
	elements: ScreenElement[],
	screenSize: ScreenSize,
): MatchResult | null {
	// 1. Match by identifier (most stable)
	if (matcher.identifier) {
		const el = elements.find(e => e.identifier === matcher.identifier);
		if (el) {
			const c = centerOf(el.rect);
			return { element: el, x: c.x, y: c.y, confidence: 1.0 };
		}
	}

	// 2. Match by label + type
	if (matcher.label && matcher.type) {
		const el = elements.find(e => e.label === matcher.label && e.type === matcher.type);
		if (el) {
			const c = centerOf(el.rect);
			return { element: el, x: c.x, y: c.y, confidence: 0.9 };
		}
	}

	// 3. Match by text + type
	if (matcher.text && matcher.type) {
		const el = elements.find(e => e.text === matcher.text && e.type === matcher.type);
		if (el) {
			const c = centerOf(el.rect);
			return { element: el, x: c.x, y: c.y, confidence: 0.85 };
		}
	}

	// 4. Match by text alone
	if (matcher.text) {
		const el = elements.find(e => e.text === matcher.text);
		if (el) {
			const c = centerOf(el.rect);
			return { element: el, x: c.x, y: c.y, confidence: 0.8 };
		}
	}

	// 5. Match by label alone
	if (matcher.label) {
		const el = elements.find(e => e.label === matcher.label);
		if (el) {
			const c = centerOf(el.rect);
			return { element: el, x: c.x, y: c.y, confidence: 0.75 };
		}
	}

	// 6. Match by name alone
	if (matcher.name) {
		const el = elements.find(e => e.name === matcher.name);
		if (el) {
			const c = centerOf(el.rect);
			return { element: el, x: c.x, y: c.y, confidence: 0.7 };
		}
	}

	// 7. Relative coordinate fallback
	if (matcher.relativeX !== undefined && matcher.relativeY !== undefined) {
		const x = Math.round(matcher.relativeX * screenSize.width);
		const y = Math.round(matcher.relativeY * screenSize.height);

		// Try to find the nearest element to the coordinates
		let nearest: ScreenElement | undefined;
		let nearestDist = Infinity;
		for (const el of elements) {
			const c = centerOf(el.rect);
			const dist = Math.hypot(c.x - x, c.y - y);
			if (dist < nearestDist && dist < 100) { // within 100px threshold
				nearest = el;
				nearestDist = dist;
			}
		}

		if (nearest) {
			const c = centerOf(nearest.rect);
			return { element: nearest, x: c.x, y: c.y, confidence: 0.4 };
		}

		// Raw coordinate fallback (no element matched)
		return {
			element: { type: "unknown", rect: { x, y, width: 0, height: 0 } },
			x,
			y,
			confidence: 0.2,
		};
	}

	return null;
}
