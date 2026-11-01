import type { RenderCrawlDetail } from "@packages/hutch-infra-components";
import type { RenderOutcome, RenderPage, RenderProxy } from "../../providers/render-page/render-page.types";

export type RenderedThrough = "direct-egress" | "residential-proxy";

type RenderedPage = Extract<RenderOutcome, { kind: "rendered" }>;
export type TerminalRenderOutcome = Exclude<RenderOutcome, { kind: "rendered" }>;

export type ProxiedFetchAttempt = { kind: "committed" } | { kind: "settled" } | { kind: "no-body"; outcome: string };
type ProxiedFetchReport = Extract<ProxiedFetchAttempt, { kind: "no-body" }> | { kind: "not-attempted" };

const DIRECT_NAVIGATION_TIMEOUT_MILLISECONDS = 30_000;
const PROXIED_NAVIGATION_TIMEOUT_MILLISECONDS = 90_000;

export type RenderLadderResult =
	| (RenderedPage & { renderedThrough: RenderedThrough })
	| { kind: "fetched-through-proxy" }
	| { kind: "settled-by-proxied-fetch" }
	| { kind: "budget-exhausted"; direct: TerminalRenderOutcome; proxiedFetch: ProxiedFetchReport }
	| { kind: "unrendered"; direct: TerminalRenderOutcome; proxied: TerminalRenderOutcome; proxiedFetch: ProxiedFetchReport };

export type RenderLadderLegs = {
	renderPage: RenderPage;
	url: string;
	proxy: RenderProxy;
	unsupportedReason: RenderCrawlDetail["unsupportedReason"];
	fetchThroughProxy: () => Promise<ProxiedFetchAttempt>;
	consumeBudget: () => Promise<{ allowed: boolean }>;
};

export async function runRenderLadder(legs: RenderLadderLegs): Promise<RenderLadderResult> {
	const { renderPage, url } = legs;
	const direct = await renderPage({ url, navigationTimeoutMilliseconds: DIRECT_NAVIGATION_TIMEOUT_MILLISECONDS });
	if (direct.kind === "rendered") return { ...direct, renderedThrough: "direct-egress" };
	return escalateThroughProxy({ ...legs, direct });
}

export async function escalateThroughProxy(params: RenderLadderLegs & { direct: TerminalRenderOutcome }): Promise<RenderLadderResult> {
	const { renderPage, url, proxy, direct } = params;
	const fetchIsWorthwhile = params.unsupportedReason === "blocked" || direct.kind === "blocked";
	const proxiedFetchAttempt: ProxiedFetchAttempt | ProxiedFetchReport = fetchIsWorthwhile ? await params.fetchThroughProxy() : { kind: "not-attempted" };
	if (proxiedFetchAttempt.kind === "committed") return { kind: "fetched-through-proxy" };
	if (proxiedFetchAttempt.kind === "settled") return { kind: "settled-by-proxied-fetch" };
	const budget = await params.consumeBudget();
	if (!budget.allowed) return { kind: "budget-exhausted", direct, proxiedFetch: proxiedFetchAttempt };
	const proxied = await renderPage({ url, proxy, navigationTimeoutMilliseconds: PROXIED_NAVIGATION_TIMEOUT_MILLISECONDS });
	if (proxied.kind === "rendered") return { ...proxied, renderedThrough: "residential-proxy" };
	return { kind: "unrendered", direct, proxied, proxiedFetch: proxiedFetchAttempt };
}
