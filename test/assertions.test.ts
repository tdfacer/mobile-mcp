import assert from "node:assert";
import { findElement } from "../src/testing/procedural/element-matcher";
import { evaluateAssertion, evaluateAssertions } from "../src/testing/procedural/assertions";
import { ScreenElement, ScreenSize } from "../src/robot";
import { StepAssertion } from "../src/testing/schemas";

const screenSize: ScreenSize = { width: 1080, height: 1920, scale: 2.0 };

const elements: ScreenElement[] = [
	{ type: "Button", text: "Login", identifier: "login_btn", label: "Log in", rect: { x: 100, y: 500, width: 200, height: 60 } },
	{ type: "TextField", text: "", identifier: "email_field", name: "email", rect: { x: 100, y: 300, width: 400, height: 50 } },
	{ type: "StaticText", text: "Welcome", label: "Welcome to the app", rect: { x: 50, y: 100, width: 300, height: 40 } },
];

describe("Element Matcher", () => {
	it("should match by identifier (highest priority)", () => {
		const result = findElement({ identifier: "login_btn" }, elements, screenSize);
		assert.ok(result);
		assert.equal(result.element.identifier, "login_btn");
		assert.equal(result.confidence, 1.0);
		assert.equal(result.x, 200); // center of 100+200/2
		assert.equal(result.y, 530); // center of 500+60/2
	});

	it("should match by label + type", () => {
		const result = findElement({ label: "Log in", type: "Button" }, elements, screenSize);
		assert.ok(result);
		assert.equal(result.element.text, "Login");
		assert.equal(result.confidence, 0.9);
	});

	it("should match by text + type", () => {
		const result = findElement({ text: "Login", type: "Button" }, elements, screenSize);
		assert.ok(result);
		assert.equal(result.confidence, 0.85);
	});

	it("should match by text alone", () => {
		const result = findElement({ text: "Welcome" }, elements, screenSize);
		assert.ok(result);
		assert.equal(result.confidence, 0.8);
	});

	it("should match by label alone", () => {
		const result = findElement({ label: "Welcome to the app" }, elements, screenSize);
		assert.ok(result);
		assert.equal(result.confidence, 0.75);
	});

	it("should match by name alone", () => {
		const result = findElement({ name: "email" }, elements, screenSize);
		assert.ok(result);
		assert.equal(result.element.identifier, "email_field");
		assert.equal(result.confidence, 0.7);
	});

	it("should fall back to relative coordinates near an element", () => {
		// Relative coords pointing near the Login button center (200, 530)
		const result = findElement({ relativeX: 200 / 1080, relativeY: 530 / 1920 }, elements, screenSize);
		assert.ok(result);
		assert.equal(result.confidence, 0.4); // near an element
	});

	it("should use raw coordinates when no element is nearby", () => {
		const result = findElement({ relativeX: 0.99, relativeY: 0.99 }, elements, screenSize);
		assert.ok(result);
		assert.equal(result.confidence, 0.2);
		assert.ok(result.x > 1000);
		assert.ok(result.y > 1800);
	});

	it("should return null when nothing matches", () => {
		const result = findElement({ identifier: "nonexistent" }, elements, screenSize);
		assert.equal(result, null);
	});

	it("should prefer identifier over text", () => {
		const result = findElement({ identifier: "login_btn", text: "Welcome" }, elements, screenSize);
		assert.ok(result);
		assert.equal(result.element.text, "Login"); // matched by identifier, not text
		assert.equal(result.confidence, 1.0);
	});
});

describe("Assertions", () => {
	describe("elementExists", () => {
		it("should pass when element is found by identifier", () => {
			const assertion: StepAssertion = { type: "elementExists", params: { identifier: "login_btn" }, soft: false };
			const result = evaluateAssertion(assertion, elements);
			assert.ok(result.passed);
		});

		it("should pass when element is found by text", () => {
			const assertion: StepAssertion = { type: "elementExists", params: { text: "Login" }, soft: false };
			const result = evaluateAssertion(assertion, elements);
			assert.ok(result.passed);
		});

		it("should fail when element is not found", () => {
			const assertion: StepAssertion = { type: "elementExists", params: { identifier: "nope" }, soft: false };
			const result = evaluateAssertion(assertion, elements);
			assert.ok(!result.passed);
		});
	});

	describe("elementHasText", () => {
		it("should pass when text matches", () => {
			const assertion: StepAssertion = { type: "elementHasText", params: { identifier: "login_btn", expectedText: "Login" }, soft: false };
			const result = evaluateAssertion(assertion, elements);
			assert.ok(result.passed);
		});

		it("should fail when text doesn't match", () => {
			const assertion: StepAssertion = { type: "elementHasText", params: { identifier: "login_btn", expectedText: "Sign Up" }, soft: false };
			const result = evaluateAssertion(assertion, elements);
			assert.ok(!result.passed);
		});

		it("should fail when element not found", () => {
			const assertion: StepAssertion = { type: "elementHasText", params: { identifier: "nope", expectedText: "x" }, soft: false };
			const result = evaluateAssertion(assertion, elements);
			assert.ok(!result.passed);
		});
	});

	describe("screenContainsText", () => {
		it("should pass when text is found in element text", () => {
			const assertion: StepAssertion = { type: "screenContainsText", params: { text: "Welcome" }, soft: false };
			const result = evaluateAssertion(assertion, elements);
			assert.ok(result.passed);
		});

		it("should pass when text is found in element label", () => {
			const assertion: StepAssertion = { type: "screenContainsText", params: { text: "Log in" }, soft: false };
			const result = evaluateAssertion(assertion, elements);
			assert.ok(result.passed);
		});

		it("should fail when text not found anywhere", () => {
			const assertion: StepAssertion = { type: "screenContainsText", params: { text: "Checkout" }, soft: false };
			const result = evaluateAssertion(assertion, elements);
			assert.ok(!result.passed);
		});
	});

	describe("noErrorDialog", () => {
		it("should pass when no error dialog present", () => {
			const assertion: StepAssertion = { type: "noErrorDialog", params: {}, soft: false };
			const result = evaluateAssertion(assertion, elements);
			assert.ok(result.passed);
		});

		it("should fail when crash dialog detected", () => {
			const assertion: StepAssertion = { type: "noErrorDialog", params: {}, soft: false };
			const crashElements: ScreenElement[] = [
				...elements,
				{ type: "TextView", text: "App has stopped", rect: { x: 0, y: 0, width: 500, height: 100 } },
			];
			const result = evaluateAssertion(assertion, crashElements);
			assert.ok(!result.passed);
			assert.ok(result.message.includes("has stopped"));
		});
	});

	describe("evaluateAssertions", () => {
		it("should report all passed", () => {
			const assertions: StepAssertion[] = [
				{ type: "elementExists", params: { identifier: "login_btn" }, soft: false },
				{ type: "screenContainsText", params: { text: "Welcome" }, soft: false },
			];
			const { allPassed, results } = evaluateAssertions(assertions, elements);
			assert.ok(allPassed);
			assert.equal(results.length, 2);
		});

		it("should fail on hard assertion failure", () => {
			const assertions: StepAssertion[] = [
				{ type: "elementExists", params: { identifier: "login_btn" }, soft: false },
				{ type: "elementExists", params: { identifier: "nope" }, soft: false },
			];
			const { allPassed } = evaluateAssertions(assertions, elements);
			assert.ok(!allPassed);
		});

		it("should pass when only soft assertions fail", () => {
			const assertions: StepAssertion[] = [
				{ type: "elementExists", params: { identifier: "login_btn" }, soft: false },
				{ type: "elementExists", params: { identifier: "nope" }, soft: true },
			];
			const { allPassed, results } = evaluateAssertions(assertions, elements);
			assert.ok(allPassed);
			assert.ok(!results[1].passed); // soft failure still recorded
		});
	});
});
