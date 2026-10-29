import type { RenderOutcome, RenderPage, RenderProxy } from "../../providers/render-page/render-page.types";

export type RenderedThrough = "direct-egress" | "residential-proxy";

type RenderedPage = Extract<RenderOutcome, { kind: "rendered" }>;
export type TerminalRenderOutcome = Exclude<RenderOutcome, { kind: "rendered" }>;

const DIRECT_NAVIGATION_TIMEOUT_MILLISECONDS = 30_000;
const PROXIED_NAVIGATION_TIMEOUT_MILLISECONDS = 90_000;

export type RenderLadderResult =
	| (RenderedPage & { renderedThrough: RenderedThrough })
	| { kind: "unrendered"; direct: TerminalRenderOutcome; proxied: TerminalRenderOutcome };

export async function runRenderLadder(params: {
	renderPage: RenderPage;
	url: string;
	proxy: RenderProxy;
}): Promise<RenderLadderResult> {
	const { renderPage, url, proxy } = params;
	const direct = await renderPage({ url, navigationTimeoutMilliseconds: DIRECT_NAVIGATION_TIMEOUT_MILLISECONDS });
	if (direct.kind === "rendered") return { ...direct, renderedThrough: "direct-egress" };
	const proxied = await renderPage({ url, proxy, navigationTimeoutMilliseconds: PROXIED_NAVIGATION_TIMEOUT_MILLISECONDS });
	if (proxied.kind === "rendered") return { ...proxied, renderedThrough: "residential-proxy" };
	return { kind: "unrendered", direct, proxied };
}
