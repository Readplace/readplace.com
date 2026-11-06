import { crawlEstimateLabel } from "./crawl-estimate-label";

const KEY_ATTRIBUTE = "data-crawl-estimate-key";
const REMAINING_ATTRIBUTE = "data-remaining-seconds";
const REVEAL_ATTRIBUTE = "data-reveal-in-seconds";
const ESTIMATES = `[${KEY_ATTRIBUTE}]`;
const HIDDEN_CLASS = "crawl-estimate--hidden";
const SHOWN_KINDS = ["quiet", "counting", "almost-there"] as const;

type ShownKind = (typeof SHOWN_KINDS)[number];

const CLASS_OF: Record<ShownKind, string> = {
	quiet: "crawl-estimate--quiet",
	counting: "crawl-estimate--counting",
	"almost-there": "crawl-estimate--almost-there",
};

type ShownCount = { kind: ShownKind; remainingSeconds: number; revealInSeconds: number };

export type CrawlEstimateElement = {
	classList: { contains(token: string): boolean; replace(from: string, to: string): boolean };
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	textContent: string | null;
};

type CrawlEstimateDocument = { querySelectorAll(selectors: string): Iterable<CrawlEstimateElement> };

function readSeconds(params: { element: CrawlEstimateElement; attribute: string }): number {
	return Number(params.element.getAttribute(params.attribute));
}

function keyOf(element: CrawlEstimateElement): string {
	return String(element.getAttribute(KEY_ATTRIBUTE));
}

function shownKindOf(element: CrawlEstimateElement): ShownKind | undefined {
	return SHOWN_KINDS.find((kind) => element.classList.contains(CLASS_OF[kind]));
}

function kindAfter(count: { remainingSeconds: number; revealInSeconds: number }): ShownKind {
	if (count.revealInSeconds > 0) return "quiet";
	return count.remainingSeconds > 0 ? "counting" : "almost-there";
}

function tick(params: { element: CrawlEstimateElement; kind: ShownKind }): ShownKind {
	const { element } = params;
	const remainingSeconds = readSeconds({ element, attribute: REMAINING_ATTRIBUTE }) - 1;
	const revealInSeconds = readSeconds({ element, attribute: REVEAL_ATTRIBUTE }) - 1;
	element.setAttribute(REMAINING_ATTRIBUTE, String(remainingSeconds));
	element.setAttribute(REVEAL_ATTRIBUTE, String(Math.max(revealInSeconds, 0)));
	element.textContent = crawlEstimateLabel(remainingSeconds);
	const next = kindAfter({ remainingSeconds, revealInSeconds });
	element.classList.replace(CLASS_OF[params.kind], CLASS_OF[next]);
	return next;
}

function remember(params: { shown: Map<string, ShownCount>; element: CrawlEstimateElement; kind: ShownKind }): void {
	const { element } = params;
	params.shown.set(keyOf(element), {
		kind: params.kind,
		remainingSeconds: readSeconds({ element, attribute: REMAINING_ATTRIBUTE }),
		revealInSeconds: readSeconds({ element, attribute: REVEAL_ATTRIBUTE }),
	});
}

function restore(params: { shown: Map<string, ShownCount>; element: CrawlEstimateElement }): void {
	const { element } = params;
	const count = params.shown.get(keyOf(element));
	if (count === undefined) return;
	element.setAttribute(REMAINING_ATTRIBUTE, String(count.remainingSeconds));
	element.setAttribute(REVEAL_ATTRIBUTE, String(count.revealInSeconds));
	element.textContent = crawlEstimateLabel(count.remainingSeconds);
	element.classList.replace(HIDDEN_CLASS, CLASS_OF[count.kind]);
}

function reconcile(params: { document: CrawlEstimateDocument; shown: Map<string, ShownCount>; ticking: boolean }): void {
	for (const element of params.document.querySelectorAll(ESTIMATES)) {
		const kind = shownKindOf(element);
		if (kind === undefined) {
			restore({ shown: params.shown, element });
			continue;
		}
		const ticks = params.ticking && kind !== "almost-there";
		remember({ shown: params.shown, element, kind: ticks ? tick({ element, kind }) : kind });
	}
}

export function initCrawlEstimate(deps: {
	document: CrawlEstimateDocument;
	everySecond: (callback: () => void) => void;
	afterPageChange: (callback: () => void) => void;
}): void {
	const shown = new Map<string, ShownCount>();
	deps.everySecond(() => reconcile({ document: deps.document, shown, ticking: true }));
	deps.afterPageChange(() => reconcile({ document: deps.document, shown, ticking: false }));
}
