import type { RenderCrawlDetail } from "@packages/hutch-infra-components";
import type {
	RenderOutcome,
	RenderPage,
	ResidentialEgress,
	WebUnlockerEgress,
} from "../../providers/render-page/render-page.types";
import { RENDER_CRAWL_TIMEOUTS } from "./timeouts";

export type RenderedThrough =
	| "direct-egress"
	| "residential-per-gb"
	| "web-unlocker-render";
export type SettledThrough = RenderedThrough | "web-unlocker-fetch";

type RenderedPage = Extract<RenderOutcome, { kind: "rendered" }>;
export type TerminalRenderOutcome = Exclude<
	RenderOutcome,
	{ kind: "rendered" }
>;
export type LadderRender = RenderedPage & { renderedThrough: RenderedThrough };

export type Escalation = "available" | "exhausted";
export type RenderCommit =
	| { kind: "settled" }
	| { kind: "unreadable"; detail: string };

export type ProxiedFetchAttempt =
	| { kind: "committed" }
	| { kind: "settled" }
	| { kind: "no-body"; outcome: string };

export type SkippedLeg = {
	kind: "skipped";
	reason: "time-exhausted" | "no-block-evidence";
};
export type RenderLegReport = TerminalRenderOutcome | SkippedLeg;
export type FetchLegReport =
	| Extract<ProxiedFetchAttempt, { kind: "no-body" }>
	| SkippedLeg;

type UnrenderedLadder = {
	kind: "unrendered";
	direct: TerminalRenderOutcome;
	residential: RenderLegReport;
	webUnlockerFetch: FetchLegReport;
	webUnlockerRender: RenderLegReport;
};

export type RenderLadderResult =
	| { kind: "settled"; settledThrough: SettledThrough }
	| { kind: "budget-exhausted"; direct: TerminalRenderOutcome }
	| UnrenderedLadder;

export type RenderLadderLegs = {
	renderPage: RenderPage;
	url: string;
	residentialEgress: () => ResidentialEgress;
	webUnlockerEgress: WebUnlockerEgress;
	unsupportedReason: RenderCrawlDetail["unsupportedReason"];
	commitRender: (
		render: LadderRender,
		escalation: Escalation,
	) => Promise<RenderCommit>;
	fetchThroughWebUnlocker: () => Promise<ProxiedFetchAttempt>;
	consumeBudget: () => Promise<{ allowed: boolean }>;
	remainingMilliseconds: () => number;
};

const TIME_EXHAUSTED: SkippedLeg = {
	kind: "skipped",
	reason: "time-exhausted",
};
const NO_BLOCK_EVIDENCE: SkippedLeg = {
	kind: "skipped",
	reason: "no-block-evidence",
};

const renderAllowance = (navigationTimeoutMilliseconds: number) =>
	navigationTimeoutMilliseconds + RENDER_CRAWL_TIMEOUTS.renderOverheadMs;
const WEB_UNLOCKER_FETCH_ALLOWANCE =
	RENDER_CRAWL_TIMEOUTS.webUnlockerFetch.headersMs +
	RENDER_CRAWL_TIMEOUTS.webUnlockerFetch.bodyMs;

type LegOutcome =
	| { kind: "settled" }
	| { kind: "continue"; report: TerminalRenderOutcome };

export async function runRenderLadder(
	legs: RenderLadderLegs,
): Promise<RenderLadderResult> {
	const fitsInTime = (allowanceMilliseconds: number) =>
		legs.remainingMilliseconds() >=
		allowanceMilliseconds + RENDER_CRAWL_TIMEOUTS.finalizationReserveMs;

	const renderLeg = async (leg: {
		egress: Parameters<RenderPage>[0]["egress"];
		navigationTimeoutMilliseconds: number;
		renderedThrough: RenderedThrough;
		escalation: Escalation;
	}): Promise<LegOutcome> => {
		const outcome = await legs.renderPage({
			url: legs.url,
			egress: leg.egress,
			navigationTimeoutMilliseconds: leg.navigationTimeoutMilliseconds,
		});
		if (outcome.kind !== "rendered")
			return { kind: "continue", report: outcome };
		const commit = await legs.commitRender(
			{ ...outcome, renderedThrough: leg.renderedThrough },
			leg.escalation,
		);
		if (commit.kind === "settled") return { kind: "settled" };
		return {
			kind: "continue",
			report: {
				kind: "failed",
				detail: commit.detail,
				httpStatus: outcome.httpStatus,
				requests: outcome.requests,
			},
		};
	};

	const direct = await renderLeg({
		egress: { kind: "direct" },
		navigationTimeoutMilliseconds: RENDER_CRAWL_TIMEOUTS.directNavigationMs,
		renderedThrough: "direct-egress",
		escalation:
			legs.unsupportedReason === "blocked" ? "available" : "exhausted",
	});
	if (direct.kind === "settled")
		return { kind: "settled", settledThrough: "direct-egress" };

	if (
		!fitsInTime(renderAllowance(RENDER_CRAWL_TIMEOUTS.residentialNavigationMs))
	) {
		return {
			kind: "unrendered",
			direct: direct.report,
			residential: TIME_EXHAUSTED,
			webUnlockerFetch: TIME_EXHAUSTED,
			webUnlockerRender: TIME_EXHAUSTED,
		};
	}
	const budget = await legs.consumeBudget();
	if (!budget.allowed)
		return { kind: "budget-exhausted", direct: direct.report };

	const residential = await renderLeg({
		egress: legs.residentialEgress(),
		navigationTimeoutMilliseconds:
			RENDER_CRAWL_TIMEOUTS.residentialNavigationMs,
		renderedThrough: "residential-per-gb",
		escalation: "available",
	});
	if (residential.kind === "settled")
		return { kind: "settled", settledThrough: "residential-per-gb" };

	const blockEvidence =
		legs.unsupportedReason === "blocked" ||
		direct.report.kind === "blocked" ||
		residential.report.kind === "blocked";
	const webUnlockerFetch: ProxiedFetchAttempt | SkippedLeg = !blockEvidence
		? NO_BLOCK_EVIDENCE
		: fitsInTime(WEB_UNLOCKER_FETCH_ALLOWANCE)
			? await legs.fetchThroughWebUnlocker()
			: TIME_EXHAUSTED;
	if (
		webUnlockerFetch.kind === "committed" ||
		webUnlockerFetch.kind === "settled"
	)
		return { kind: "settled", settledThrough: "web-unlocker-fetch" };

	if (
		!fitsInTime(renderAllowance(RENDER_CRAWL_TIMEOUTS.webUnlockerNavigationMs))
	) {
		return {
			kind: "unrendered",
			direct: direct.report,
			residential: residential.report,
			webUnlockerFetch,
			webUnlockerRender: TIME_EXHAUSTED,
		};
	}
	const webUnlockerRender = await renderLeg({
		egress: legs.webUnlockerEgress,
		navigationTimeoutMilliseconds:
			RENDER_CRAWL_TIMEOUTS.webUnlockerNavigationMs,
		renderedThrough: "web-unlocker-render",
		escalation: "exhausted",
	});
	if (webUnlockerRender.kind === "settled")
		return { kind: "settled", settledThrough: "web-unlocker-render" };
	return {
		kind: "unrendered",
		direct: direct.report,
		residential: residential.report,
		webUnlockerFetch,
		webUnlockerRender: webUnlockerRender.report,
	};
}
