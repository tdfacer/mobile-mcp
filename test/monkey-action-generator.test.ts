import assert from "node:assert";
import { MonkeyActionGenerator } from "../src/testing/monkey/action-generator";
import { ScreenElement, ScreenSize } from "../src/robot";

const screenSize: ScreenSize = { width: 1080, height: 1920, scale: 2.0 };

const elements: ScreenElement[] = [
	{ type: "Button", text: "Login", rect: { x: 100, y: 500, width: 200, height: 60 } },
	{ type: "TextField", text: "", rect: { x: 100, y: 300, width: 400, height: 50 }, focused: true },
	{ type: "StaticText", text: "Welcome", rect: { x: 50, y: 100, width: 300, height: 40 } },
];

describe("MonkeyActionGenerator", () => {
	it("should produce deterministic sequence with same seed", () => {
		const gen1 = new MonkeyActionGenerator({ seed: 42 });
		const gen2 = new MonkeyActionGenerator({ seed: 42 });

		const actions1 = Array.from({ length: 20 }, () => gen1.generate(elements, screenSize));
		const actions2 = Array.from({ length: 20 }, () => gen2.generate(elements, screenSize));

		for (let i = 0; i < 20; i++) {
			assert.equal(actions1[i].type, actions2[i].type);
			assert.deepEqual(actions1[i].params, actions2[i].params);
		}
	});

	it("should produce different sequences with different seeds", () => {
		const gen1 = new MonkeyActionGenerator({ seed: 42 });
		const gen2 = new MonkeyActionGenerator({ seed: 99 });

		const actions1 = Array.from({ length: 10 }, () => gen1.generate(elements, screenSize));
		const actions2 = Array.from({ length: 10 }, () => gen2.generate(elements, screenSize));

		// At least some should differ
		const hasDifference = actions1.some((a, i) => a.type !== actions2[i].type);
		assert.ok(hasDifference, "Different seeds should produce different sequences");
	});

	it("should generate all action kinds over many iterations", () => {
		const gen = new MonkeyActionGenerator({ seed: 12345 });
		const kinds = new Set<string>();

		for (let i = 0; i < 500; i++) {
			const action = gen.generate(elements, screenSize);
			kinds.add(action.kind);
		}

		assert.ok(kinds.has("tapElement"), "Should generate tapElement");
		assert.ok(kinds.has("tapRandom"), "Should generate tapRandom");
		assert.ok(kinds.has("swipe"), "Should generate swipe");
		assert.ok(kinds.has("pressBack"), "Should generate pressBack");
		assert.ok(kinds.has("longPress"), "Should generate longPress");
		// typeText only when focused text field exists
		assert.ok(kinds.has("typeText"), "Should generate typeText (focused field exists)");
	});

	it("should not generate typeText when no field is focused", () => {
		const gen = new MonkeyActionGenerator({ seed: 42 });
		const noFocusElements: ScreenElement[] = [
			{ type: "Button", text: "OK", rect: { x: 100, y: 200, width: 100, height: 40 } },
		];

		const actions = Array.from({ length: 200 }, () => gen.generate(noFocusElements, screenSize));
		const hasTypeText = actions.some(a => a.kind === "typeText");
		assert.ok(!hasTypeText, "Should not typeText when no field is focused");
	});

	it("should handle empty element list", () => {
		const gen = new MonkeyActionGenerator({ seed: 42 });
		const actions = Array.from({ length: 50 }, () => gen.generate([], screenSize));

		// Should not crash, should still produce actions
		assert.ok(actions.length === 50);
		// Should not try to tap elements
		const hasTapElement = actions.some(a => a.kind === "tapElement");
		assert.ok(!hasTapElement, "Should not tapElement when list is empty");
	});

	it("should generate valid coordinates for tapRandom", () => {
		const gen = new MonkeyActionGenerator({ seed: 42, actionWeights: { tapRandom: 100, tapElement: 0, swipe: 0, pressBack: 0, typeText: 0, longPress: 0 } });

		for (let i = 0; i < 50; i++) {
			const action = gen.generate([], screenSize);
			const params = action.params as { x: number; y: number };
			assert.ok(params.x >= 0 && params.x <= screenSize.width, `x=${params.x} out of bounds`);
			assert.ok(params.y >= 80, `y=${params.y} should be below status bar`);
		}
	});

	it("should respect custom action weights", () => {
		const gen = new MonkeyActionGenerator({
			seed: 42,
			actionWeights: { tapElement: 0, tapRandom: 0, swipe: 100, pressBack: 0, typeText: 0, longPress: 0 },
		});

		const actions = Array.from({ length: 20 }, () => gen.generate(elements, screenSize));
		assert.ok(actions.every(a => a.kind === "swipe"), "All actions should be swipe");
	});

	it("should generate pressBack as pressButton", () => {
		const gen = new MonkeyActionGenerator({
			seed: 42,
			actionWeights: { tapElement: 0, tapRandom: 0, swipe: 0, pressBack: 100, typeText: 0, longPress: 0 },
		});

		const action = gen.generate(elements, screenSize);
		assert.equal(action.type, "pressButton");
		assert.deepEqual(action.params, { button: "BACK" });
	});
});
