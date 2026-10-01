import assert from "node:assert";
import { parseHTML } from "linkedom";

type CtaTag = "a" | "form" | "formaction" | "hx-get" | "hx-post";

type CtaProblem = "untracked" | "shared-content" | "auto-fired-unmarked" | "background-tagged";

export interface UntrackedCta {
	tag: CtaTag;
	method: "GET" | "POST";
	target: string;
	label: string;
	problem: CtaProblem;
}

export interface FindUntrackedCtasOptions {
	skipSelectors: readonly string[];
	ownOrigin: string;
}

export const BACKGROUND_REQUEST_ATTRIBUTE = "data-background-request";

const INTERNAL_MEDIUM = "internal";

const AUTO_FIRED_TRIGGERS = new Set(["load", "every", "revealed", "intersect"]);

type TrackingParams = { get(name: string): string | null };

interface Markers {
	source: string;
	content: string;
}

interface Scanned {
	element: Element;
	tag: CtaTag;
	method: "GET" | "POST";
	target: string;
	markers: Markers | undefined;
}

function isOwnOrigin(input: { target: string; ownOrigin: string }): boolean {
	if (input.target.startsWith("/")) return !input.target.startsWith("//");
	return URL.canParse(input.target) && new URL(input.target).origin === input.ownOrigin;
}

function markersIn(params: TrackingParams): Markers | undefined {
	const source = params.get("utm_source");
	const content = params.get("utm_content");
	if (!source || !content || params.get("utm_medium") !== INTERNAL_MEDIUM) return undefined;
	return { source, content };
}

function queryMarkers(input: { target: string; ownOrigin: string }): Markers | undefined {
	return markersIn(new URL(input.target, input.ownOrigin).searchParams);
}

function hiddenInputMarkers(form: Element): Markers | undefined {
	return markersIn({
		get: (name) => form.querySelector(`input[name="${name}"]`)?.getAttribute("value") ?? null,
	});
}

function shapeOf(part: string): string {
	return /[\d%]/.test(part) ? "{id}" : part;
}

function destinationOf(input: { method: "GET" | "POST"; target: string; ownOrigin: string }): string {
	const url = new URL(input.target, input.ownOrigin);
	const path = url.pathname.split("/").map(shapeOf).join("/");
	const query = Array.from(url.searchParams)
		.filter(([name]) => !name.startsWith("utm_"))
		.map(([name, value]) => `${name}=${shapeOf(value)}`)
		.sort()
		.join("&");
	return `${input.method} ${path}?${query}`;
}

function isAutoFired(element: Element): boolean {
	const trigger = element.getAttribute("hx-trigger") ?? "";
	return trigger.split(",").some((spec) => AUTO_FIRED_TRIGGERS.has(spec.trim().split(/\s+/)[0]));
}

function methodOf(form: Element): "GET" | "POST" {
	return form.getAttribute("method")?.toUpperCase() === "POST" ? "POST" : "GET";
}

function formactionMethodOf(button: Element): "GET" | "POST" {
	const own = button.getAttribute("formmethod");
	if (own !== null) return own.toUpperCase() === "POST" ? "POST" : "GET";
	const form = button.closest("form");
	return form ? methodOf(form) : "GET";
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

function report(scanned: Scanned, problem: CtaProblem): UntrackedCta {
	return { tag: scanned.tag, method: scanned.method, target: scanned.target, label: labelOf(scanned.element), problem };
}

function carriesAnyMarker(input: { target: string; ownOrigin: string }): boolean {
	return Array.from(new URL(input.target, input.ownOrigin).searchParams.keys()).some((name) => name.startsWith("utm_"));
}

function problemOf(input: { scanned: Scanned; ownOrigin: string }): CtaProblem | undefined {
	const marked = input.scanned.element.hasAttribute(BACKGROUND_REQUEST_ATTRIBUTE);
	if (!marked && isAutoFired(input.scanned.element)) return "auto-fired-unmarked";
	if (marked) return carriesAnyMarker({ target: input.scanned.target, ownOrigin: input.ownOrigin }) ? "background-tagged" : undefined;
	return input.scanned.markers ? undefined : "untracked";
}

function sharedContent(input: { scanned: readonly Scanned[]; ownOrigin: string }): UntrackedCta[] {
	const destinations = new Map<string, Set<string>>();
	const keyOf = (markers: Markers) => `${markers.source}\n${markers.content}`;
	for (const scanned of input.scanned) {
		if (!scanned.markers) continue;
		const key = keyOf(scanned.markers);
		const seen = destinations.get(key) ?? new Set<string>();
		seen.add(destinationOf({ method: scanned.method, target: scanned.target, ownOrigin: input.ownOrigin }));
		destinations.set(key, seen);
	}
	return input.scanned.flatMap((scanned) => {
		if (!scanned.markers) return [];
		const seen = destinations.get(keyOf(scanned.markers));
		assert(seen, "every marked CTA registered its destination above");
		return seen.size > 1 ? [report(scanned, "shared-content")] : [];
	});
}

export function findUntrackedCtas(
	html: string,
	options: FindUntrackedCtasOptions,
): UntrackedCta[] {
	const { document } = parseHTML(html);
	const skipped = options.skipSelectors.flatMap((selector) =>
		Array.from(document.querySelectorAll(selector)),
	);
	const ownOrigin = options.ownOrigin;

	function scan(input: {
		selector: string;
		attribute: string;
		tag: CtaTag;
		methodOf: (element: Element) => "GET" | "POST";
		markersOf: (input: { element: Element; target: string; method: "GET" | "POST" }) => Markers | undefined;
	}): Scanned[] {
		return Array.from(document.querySelectorAll(input.selector)).flatMap((element) => {
			const target = requiredAttribute(element, input.attribute);
			if (!isOwnOrigin({ target, ownOrigin })) return [];
			if (skipped.some((region) => region.contains(element))) return [];
			const method = input.methodOf(element);
			return [{ element, tag: input.tag, method, target, markers: input.markersOf({ element, target, method }) }];
		});
	}

	const fromQuery = ({ target }: { target: string }) => queryMarkers({ target, ownOrigin });

	const scanned = [
		...scan({
			selector: "a[href]",
			attribute: "href",
			tag: "a",
			methodOf: () => "GET",
			markersOf: fromQuery,
		}),
		...scan({
			selector: "form[action]",
			attribute: "action",
			tag: "form",
			methodOf,
			markersOf: ({ element, target, method }) =>
				method === "POST" ? queryMarkers({ target, ownOrigin }) : hiddenInputMarkers(element),
		}),
		...scan({
			selector: "button[formaction]",
			attribute: "formaction",
			tag: "formaction",
			methodOf: formactionMethodOf,
			markersOf: ({ element, target, method }) => {
				if (method === "POST") return queryMarkers({ target, ownOrigin });
				const form = element.closest("form");
				return form ? hiddenInputMarkers(form) : undefined;
			},
		}),
		...scan({
			selector: "[hx-get]",
			attribute: "hx-get",
			tag: "hx-get",
			methodOf: () => "GET",
			markersOf: ({ element, target }) =>
				queryMarkers({ target, ownOrigin }) ?? (element.tagName === "FORM" ? hiddenInputMarkers(element) : undefined),
		}),
		...scan({
			selector: "[hx-post]",
			attribute: "hx-post",
			tag: "hx-post",
			methodOf: () => "POST",
			markersOf: fromQuery,
		}),
	];

	return [
		...scanned.flatMap((cta) => {
			const problem = problemOf({ scanned: cta, ownOrigin });
			return problem ? [report(cta, problem)] : [];
		}),
		...sharedContent({
			scanned: scanned.filter(
				(cta, index) =>
					!cta.element.hasAttribute(BACKGROUND_REQUEST_ATTRIBUTE) &&
					scanned.findIndex((other) => other.element === cta.element) === index,
			),
			ownOrigin,
		}),
	];
}

export function describeUntrackedCtas(untracked: readonly UntrackedCta[]): string[] {
	return untracked.map((cta) => `${cta.problem}: ${cta.tag} ${cta.method} ${cta.target} — ${cta.label}`);
}
