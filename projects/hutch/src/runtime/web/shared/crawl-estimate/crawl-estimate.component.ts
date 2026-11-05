import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CrawlRemainingEstimate } from "@packages/domain/article";
import { render } from "@packages/web-shell";
import { crawlEstimateLabel } from "./crawl-estimate-label";

const TEMPLATE = readFileSync(join(__dirname, "crawl-estimate.template.html"), "utf-8");

export const CRAWL_ESTIMATE_SCRIPT = `<script src="/client-dist/crawl-estimate.client.js" defer></script>`;

function displayOf(estimate: CrawlRemainingEstimate | undefined) {
	if (estimate === undefined) return { kind: "hidden", remainingSeconds: 0, revealInSeconds: 0 };
	switch (estimate.kind) {
		case "quiet":
			return { kind: "quiet", remainingSeconds: estimate.seconds, revealInSeconds: estimate.revealInSeconds };
		case "counting":
			return { kind: "counting", remainingSeconds: estimate.seconds, revealInSeconds: 0 };
		case "almost-there":
			return { kind: "almost-there", remainingSeconds: 0, revealInSeconds: 0 };
	}
}

export function renderCrawlEstimate(estimate: CrawlRemainingEstimate | undefined): string {
	const display = displayOf(estimate);
	return render(TEMPLATE, { ...display, label: crawlEstimateLabel(display.remainingSeconds) }).trim();
}
