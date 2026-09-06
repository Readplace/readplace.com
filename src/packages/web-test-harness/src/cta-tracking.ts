import assert from "node:assert";
import { parseHTML } from "linkedom";

export interface UntrackedCta {
	tag: "a" | "form";
	method: "GET" | "POST";
	target: string;
	label: string;
}

export interface FindUntrackedCtasOptions {
	skipSelectors: readonly string[];
}

const PARSE_ORIGIN = "https://internal.invalid";

function isOwnOrigin(target: string): boolean {
	return target.startsWith("/") && !target.startsWith("//");
}

function hasTrackedQuery(target: string): boolean {
	const source = new URL(target, PARSE_ORIGIN).searchParams.get("utm_source");
	return source !== null && source.length > 0;
}

function hasTrackedHiddenInput(form: Element): boolean {
	const value = form.querySelector('input[name="utm_source"]')?.getAttribute("value");
	return typeof value === "string" && value.length > 0;
}

function methodOf(form: Element): "GET" | "POST" {
	return form.getAttribute("method")?.toUpperCase() === "POST" ? "POST" : "GET";
}

function labelOf(element: Element): string {
	const textContent = element.textContent;
	assert(textContent !== null, "an element parsed from HTML always has textContent");
	const text = textContent.replace(/\s+/g, " ").trim();
	if (text.length > 0) return text.slice(0, 60);
	return element.getAttribute("aria-label") ?? "";
}

function requiredAttribute(element: Element, name: string): string {
	const value = element.getAttribute(name);
	assert(value !== null, `the [${name}] selector only matches elements that have one`);
	return value;
}

function isReportable(input: {
	element: Element;
	target: string;
	skipped: readonly Element[];
	tracked: boolean;
}): boolean {
	if (!isOwnOrigin(input.target)) return false;
	if (input.skipped.some((region) => region.contains(input.element))) return false;
	return !input.tracked;
}

export function findUntrackedCtas(
	html: string,
	options: FindUntrackedCtasOptions,
): UntrackedCta[] {
	const { document } = parseHTML(html);
	const skipped = options.skipSelectors.flatMap((selector) =>
		Array.from(document.querySelectorAll(selector)),
	);
	const anchors = Array.from(document.querySelectorAll("a[href]")).flatMap((anchor) => {
		const target = requiredAttribute(anchor, "href");
		const tracked = hasTrackedQuery(target);
		return isReportable({ element: anchor, target, skipped, tracked })
			? [{ tag: "a", method: "GET", target, label: labelOf(anchor) } satisfies UntrackedCta]
			: [];
	});
	const forms = Array.from(document.querySelectorAll("form[action]")).flatMap((form) => {
		const target = requiredAttribute(form, "action");
		const method = methodOf(form);
		const tracked =
			method === "POST" ? hasTrackedQuery(target) : hasTrackedHiddenInput(form);
		return isReportable({ element: form, target, skipped, tracked })
			? [{ tag: "form", method, target, label: labelOf(form) } satisfies UntrackedCta]
			: [];
	});
	return [...anchors, ...forms];
}

export function describeUntrackedCtas(untracked: readonly UntrackedCta[]): string[] {
	return untracked.map((cta) => `${cta.tag} ${cta.method} ${cta.target} — ${cta.label}`);
}
