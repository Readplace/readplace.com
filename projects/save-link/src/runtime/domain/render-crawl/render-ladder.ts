import type { RenderCrawlDetail } from "@packages/infra-components";
import type { MeteredLeg, PaidLegPermit } from "@packages/provider-contracts/metered-leg-ledger";
import type { CandidateReference } from "../select-content/list-available-tier-sources";
import type {
	RenderOutcome,
	RenderPage,
	ResidentialEgress,
	WebUnlockerEgress,
} from "./render-page.types";
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
	| { kind: "committed"; candidate: CandidateReference }
	| { kind: "settled" }
	| { kind: "unreadable"; detail: string };

export type ProxiedFetchAttempt =
	| { kind: "committed"; candidate: CandidateReference }
	| { kind: "settled" }
	| { kind: "no-body"; outcome: string };

export type SkippedLeg = {
	kind: "skipped";
	reason: "time-exhausted" | "no-block-evidence" | "block-evidence" | "deferred";
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

type SettledLadder = {
	kind: "settled";
	settledThrough: SettledThrough;
	residentialSkipped: boolean;
};

export type RenderMeteredLeg = Extract<
	MeteredLeg,
	| "render-residential-per-gb"
	| "render-web-unlocker-fetch"
	| "render-web-unlocker-render"
>;

const BUDGET_GATE = {
	"render-residential-per-gb": "residential-per-gb",
	"render-web-unlocker-fetch": "web-unlocker-fetch",
	"render-web-unlocker-render": "web-unlocker-render",
} as const;

type BudgetExhaustedLadder = {
	kind: "budget-exhausted";
	gate: (typeof BUDGET_GATE)[RenderMeteredLeg];
	direct: TerminalRenderOutcome;
};

type DeferredLadder = {
	kind: "deferred";
	awaiting: "render-residential-per-gb";
	direct: TerminalRenderOutcome;
};

type RecordedLadder = {
	kind: "recorded";
	leg: RenderMeteredLeg;
	outcome: string;
};

type InFlightLadder = {
	kind: "in-flight";
	leg: RenderMeteredLeg;
};

export type RenderLadderResult =
	| SettledLadder
	| BudgetExhaustedLadder
	| UnrenderedLadder
	| DeferredLadder
	| RecordedLadder
	| InFlightLadder;

export type RenderLegClaim =
	| { kind: "granted"; permit: PaidLegPermit }
	| { kind: "deferred" }
	| { kind: "settled"; outcome: string }
	| { kind: "in-flight" }
	| { kind: "budget-exhausted" };

type RenderRecoveryEvent =
	| { phase: "started" }
	| { phase: "finished"; outcome: "committed" | "settled" | "failed" | "blocked" | "threw"; httpStatus?: number };

export type RenderRecoveryAttempt = {
	policyVersion: "residential-after-gateway-502-v1";
	host: string;
} & RenderRecoveryEvent;

export type RenderLadderLegs = {
	renderPage: RenderPage;
	url: string;
	residentialEgress: (permit: PaidLegPermit) => ResidentialEgress;
	webUnlockerEgress: (permit: PaidLegPermit) => WebUnlockerEgress;
	unsupportedReason: RenderCrawlDetail["unsupportedReason"];
	commitRender: (
		render: LadderRender,
		escalation: Escalation,
	) => Promise<RenderCommit>;
	fetchThroughWebUnlocker: (
		permit: PaidLegPermit,
	) => Promise<ProxiedFetchAttempt>;
	claimLeg: (leg: RenderMeteredLeg) => Promise<RenderLegClaim>;
	settleLeg: (p: {
		permit: PaidLegPermit;
		candidate: CandidateReference;
	}) => Promise<void>;
	releaseLeg: (permit: PaidLegPermit) => Promise<void>;
	remainingMilliseconds: () => number;
	reportRecoveryAttempt: (attempt: RenderRecoveryAttempt) => void;
};

const TIME_EXHAUSTED: SkippedLeg = {
	kind: "skipped",
	reason: "time-exhausted",
};
const BLOCK_EVIDENCE: SkippedLeg = {
	kind: "skipped",
	reason: "block-evidence",
};
const NO_BLOCK_EVIDENCE: SkippedLeg = {
	kind: "skipped",
	reason: "no-block-evidence",
};
const DEFERRED: SkippedLeg = {
	kind: "skipped",
	reason: "deferred",
};

const renderAllowance = (navigationTimeoutMilliseconds: number) =>
	navigationTimeoutMilliseconds + RENDER_CRAWL_TIMEOUTS.renderOverheadMs;
const WEB_UNLOCKER_FETCH_ALLOWANCE =
	RENDER_CRAWL_TIMEOUTS.webUnlockerFetch.headersMs +
	RENDER_CRAWL_TIMEOUTS.webUnlockerFetch.bodyMs;

type LegOutcome =
	| { kind: "committed"; candidate: CandidateReference }
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
		if (commit.kind !== "unreadable") return commit;
		return {
			kind: "continue",
			report: {
				kind: "failed",
				detail: commit.detail,
				httpStatus: outcome.httpStatus,
				requests: outcome.requests,
				resourceHosts: outcome.resourceHosts,
			},
		};
	};

	const underPermit = async <Outcome extends LegOutcome | ProxiedFetchAttempt>(
		permit: PaidLegPermit,
		attempt: () => Promise<Outcome>,
	): Promise<Outcome> => {
		let outcome: Outcome;
		try {
			outcome = await attempt();
		} catch (error) {
			await legs.releaseLeg(permit);
			throw error;
		}
		const ran: LegOutcome | ProxiedFetchAttempt = outcome;
		if (ran.kind === "committed")
			await legs.settleLeg({ permit, candidate: ran.candidate });
		else await legs.releaseLeg(permit);
		return outcome;
	};

	const stopped = (
		leg: RenderMeteredLeg,
		claim: Exclude<RenderLegClaim, { kind: "granted" } | { kind: "deferred" }>,
		direct: TerminalRenderOutcome,
	): RenderLadderResult => {
		if (claim.kind === "settled")
			return { kind: "recorded", leg, outcome: claim.outcome };
		if (claim.kind === "in-flight") return { kind: "in-flight", leg };
		return { kind: "budget-exhausted", gate: BUDGET_GATE[leg], direct };
	};

	const direct = await renderLeg({
		egress: { kind: "direct" },
		navigationTimeoutMilliseconds: RENDER_CRAWL_TIMEOUTS.directNavigationMs,
		renderedThrough: "direct-egress",
		escalation:
			legs.unsupportedReason === "blocked" ? "available" : "exhausted",
	});
	if (direct.kind !== "continue")
		return {
			kind: "settled",
			settledThrough: "direct-egress",
			residentialSkipped: false,
		};

	const blockedBeforeResidential =
		legs.unsupportedReason === "blocked" || direct.report.kind === "blocked";
	let residentialReport: RenderLegReport = BLOCK_EVIDENCE;
	if (!blockedBeforeResidential) {
		if (
			!fitsInTime(
				renderAllowance(RENDER_CRAWL_TIMEOUTS.residentialNavigationMs),
			)
		) {
			return {
				kind: "unrendered",
				direct: direct.report,
				residential: TIME_EXHAUSTED,
				webUnlockerFetch: TIME_EXHAUSTED,
				webUnlockerRender: TIME_EXHAUSTED,
			};
		}
		const claim = await legs.claimLeg("render-residential-per-gb");
		if (claim.kind === "deferred")
			return {
				kind: "deferred",
				awaiting: "render-residential-per-gb",
				direct: direct.report,
			};
		if (claim.kind !== "granted")
			return stopped("render-residential-per-gb", claim, direct.report);
		const residential = await underPermit(claim.permit, () =>
			renderLeg({
				egress: legs.residentialEgress(claim.permit),
				navigationTimeoutMilliseconds:
					RENDER_CRAWL_TIMEOUTS.residentialNavigationMs,
				renderedThrough: "residential-per-gb",
				escalation: "available",
			}),
		);
		if (residential.kind !== "continue")
			return {
				kind: "settled",
				settledThrough: "residential-per-gb",
				residentialSkipped: false,
			};
		residentialReport = residential.report;
	}
	const residentialSkipped = blockedBeforeResidential;

	const blockEvidence =
		blockedBeforeResidential || residentialReport.kind === "blocked";
	let webUnlockerFetch: ProxiedFetchAttempt | SkippedLeg = NO_BLOCK_EVIDENCE;
	if (blockEvidence) {
		if (!fitsInTime(WEB_UNLOCKER_FETCH_ALLOWANCE)) {
			webUnlockerFetch = TIME_EXHAUSTED;
		} else {
			const claim = await legs.claimLeg("render-web-unlocker-fetch");
			if (claim.kind === "deferred") {
				webUnlockerFetch = DEFERRED;
			} else if (claim.kind !== "granted") {
				return stopped("render-web-unlocker-fetch", claim, direct.report);
			} else {
				webUnlockerFetch = await underPermit(claim.permit, () =>
					legs.fetchThroughWebUnlocker(claim.permit),
				);
			}
		}
	}
	if (
		webUnlockerFetch.kind === "committed" ||
		webUnlockerFetch.kind === "settled"
	)
		return {
			kind: "settled",
			settledThrough: "web-unlocker-fetch",
			residentialSkipped,
		};

	if (
		!fitsInTime(renderAllowance(RENDER_CRAWL_TIMEOUTS.webUnlockerNavigationMs))
	) {
		return {
			kind: "unrendered",
			direct: direct.report,
			residential: residentialReport,
			webUnlockerFetch,
			webUnlockerRender: TIME_EXHAUSTED,
		};
	}
	const renderClaim = await legs.claimLeg("render-web-unlocker-render");
	if (renderClaim.kind === "deferred")
		return {
			kind: "unrendered",
			direct: direct.report,
			residential: residentialReport,
			webUnlockerFetch,
			webUnlockerRender: DEFERRED,
		};
	if (renderClaim.kind !== "granted")
		return stopped("render-web-unlocker-render", renderClaim, direct.report);
	const webUnlockerRender = await underPermit(renderClaim.permit, () =>
		renderLeg({
			egress: legs.webUnlockerEgress(renderClaim.permit),
			navigationTimeoutMilliseconds:
				RENDER_CRAWL_TIMEOUTS.webUnlockerNavigationMs,
			renderedThrough: "web-unlocker-render",
			escalation: "exhausted",
		}),
	);
	if (webUnlockerRender.kind !== "continue")
		return {
			kind: "settled",
			settledThrough: "web-unlocker-render",
			residentialSkipped,
		};
	const recoveryUrl = URL.parse(legs.url);
	const recoveryHost = recoveryUrl?.protocol === "https:" && recoveryUrl.port === ""
		? recoveryUrl.hostname : undefined;
	if (
		recoveryHost !== undefined &&
		residentialReport.kind === "skipped" && residentialReport.reason === "block-evidence" &&
		webUnlockerRender.report.kind === "failed" && webUnlockerRender.report.httpStatus === 502
	) {
		const allowance = renderAllowance(RENDER_CRAWL_TIMEOUTS.residentialNavigationMs);
		if (!fitsInTime(allowance)) {
			residentialReport = TIME_EXHAUSTED;
		} else {
			const claim = await legs.claimLeg("render-residential-per-gb");
			if (claim.kind === "deferred")
				return { kind: "deferred", awaiting: "render-residential-per-gb", direct: direct.report };
			if (claim.kind !== "granted")
				return stopped("render-residential-per-gb", claim, direct.report);
			if (!fitsInTime(allowance)) {
				await legs.releaseLeg(claim.permit);
				residentialReport = TIME_EXHAUSTED;
			} else {
				const report = (attempt: RenderRecoveryEvent) =>
					legs.reportRecoveryAttempt({ ...attempt, host: recoveryHost, policyVersion: "residential-after-gateway-502-v1" });
				let recovery: LegOutcome;
				try {
					recovery = await underPermit(claim.permit, () => {
						const egress = legs.residentialEgress(claim.permit);
						report({ phase: "started" });
						return renderLeg({
							egress,
							navigationTimeoutMilliseconds: RENDER_CRAWL_TIMEOUTS.residentialNavigationMs,
							renderedThrough: "residential-per-gb",
							escalation: "available",
						});
					});
				} catch (error) {
					report({ phase: "finished", outcome: "threw" });
					throw error;
				}
				if (recovery.kind !== "continue") {
					report({ phase: "finished", outcome: recovery.kind });
					return { kind: "settled", settledThrough: "residential-per-gb", residentialSkipped: false };
				}
				report({ phase: "finished", outcome: recovery.report.kind, httpStatus: recovery.report.httpStatus });
				residentialReport = recovery.report;
			}
		}
	}
	return {
		kind: "unrendered",
		direct: direct.report,
		residential: residentialReport,
		webUnlockerFetch,
		webUnlockerRender: webUnlockerRender.report,
	};
}
