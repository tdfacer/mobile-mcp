import { StepAssertion } from "../schemas";
import { ScreenElement } from "../../robot";

export interface AssertionResult {
	passed: boolean;
	assertion: StepAssertion;
	message: string;
}

const ERROR_DIALOG_PATTERNS = [
	"unfortunately",
	"has stopped",
	"keeps stopping",
	"isn't responding",
	"not responding",
	"application error",
	"app not responding",
];

export function evaluateAssertion(
	assertion: StepAssertion,
	elements: ScreenElement[],
): AssertionResult {
	switch (assertion.type) {
		case "elementExists":
			return evaluateElementExists(assertion, elements);
		case "elementHasText":
			return evaluateElementHasText(assertion, elements);
		case "screenContainsText":
			return evaluateScreenContainsText(assertion, elements);
		case "noErrorDialog":
			return evaluateNoErrorDialog(assertion, elements);
		default:
			return { passed: false, assertion, message: `Unknown assertion type: ${assertion.type}` };
	}
}

export function evaluateAssertions(
	assertions: StepAssertion[],
	elements: ScreenElement[],
): { allPassed: boolean; results: AssertionResult[] } {
	const results = assertions.map(a => evaluateAssertion(a, elements));
	const allPassed = results.every(r => r.passed || r.assertion.soft);
	return { allPassed, results };
}

function evaluateElementExists(
	assertion: StepAssertion,
	elements: ScreenElement[],
): AssertionResult {
	const { identifier, text, label } = assertion.params;

	const found = elements.some(e =>
		(identifier && e.identifier === identifier) ||
		(text && e.text === text) ||
		(label && e.label === label)
	);

	return {
		passed: found,
		assertion,
		message: found
			? "Element found"
			: `Element not found (identifier=${identifier}, text=${text}, label=${label})`,
	};
}

function evaluateElementHasText(
	assertion: StepAssertion,
	elements: ScreenElement[],
): AssertionResult {
	const { identifier, expectedText } = assertion.params;
	const el = elements.find(e => e.identifier === identifier);

	if (!el) {
		return { passed: false, assertion, message: `Element with identifier "${identifier}" not found` };
	}

	const matches = el.text === expectedText;
	return {
		passed: matches,
		assertion,
		message: matches
			? `Element text matches: "${expectedText}"`
			: `Element text mismatch: expected "${expectedText}", got "${el.text}"`,
	};
}

function evaluateScreenContainsText(
	assertion: StepAssertion,
	elements: ScreenElement[],
): AssertionResult {
	const { text } = assertion.params;
	const found = elements.some(e =>
		(e.text && e.text.includes(text)) ||
		(e.label && e.label.includes(text))
	);

	return {
		passed: found,
		assertion,
		message: found
			? `Screen contains text: "${text}"`
			: `Screen does not contain text: "${text}"`,
	};
}

function evaluateNoErrorDialog(
	assertion: StepAssertion,
	elements: ScreenElement[],
): AssertionResult {
	for (const el of elements) {
		const combined = `${el.text ?? ""} ${el.label ?? ""}`.toLowerCase();
		for (const pattern of ERROR_DIALOG_PATTERNS) {
			if (combined.includes(pattern)) {
				return {
					passed: false,
					assertion,
					message: `Error dialog detected: "${el.text ?? el.label}" matches pattern "${pattern}"`,
				};
			}
		}
	}

	return { passed: true, assertion, message: "No error dialog detected" };
}
