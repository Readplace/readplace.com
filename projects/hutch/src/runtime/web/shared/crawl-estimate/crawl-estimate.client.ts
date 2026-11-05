import { crawlEstimateLabel } from "./crawl-estimate-label";

const TICKING = ".crawl-estimate--quiet, .crawl-estimate--counting";

export type CrawlEstimateElement = {
	classList: { replace(from: string, to: string): boolean };
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	textContent: string | null;
};

function readSeconds(params: { element: CrawlEstimateElement; attribute: string }): number {
	return Number(params.element.getAttribute(params.attribute));
}

function tick(element: CrawlEstimateElement): void {
	const remainingSeconds = readSeconds({ element, attribute: "data-remaining-seconds" }) - 1;
	const revealInSeconds = readSeconds({ element, attribute: "data-reveal-in-seconds" }) - 1;
	element.setAttribute("data-remaining-seconds", String(remainingSeconds));
	element.setAttribute("data-reveal-in-seconds", String(Math.max(revealInSeconds, 0)));
	element.textContent = crawlEstimateLabel(remainingSeconds);
	if (revealInSeconds <= 0) element.classList.replace("crawl-estimate--quiet", "crawl-estimate--counting");
	if (remainingSeconds <= 0) element.classList.replace("crawl-estimate--counting", "crawl-estimate--almost-there");
}

export function initCrawlEstimate(deps: {
	document: { querySelectorAll(selectors: string): Iterable<CrawlEstimateElement> };
	everySecond: (callback: () => void) => void;
}): void {
	deps.everySecond(() => {
		for (const element of deps.document.querySelectorAll(TICKING)) tick(element);
	});
}
