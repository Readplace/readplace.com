import type { RenderOutcome, RenderPage, RenderProxy } from "../../providers/render-page/render-page.types";
import { escalateThroughProxy, type ProxiedFetchAttempt, runRenderLadder, type TerminalRenderOutcome } from "./render-ladder";

const URL = "https://example-spa.test/post";
const residentialProxy: RenderProxy = { server: "http://proxy.example.test:22225", username: "zone-user", password: "zone-secret" };
const requests = { continued: 1, abortedByBudget: 0, abortedByType: 0, continuedByResourceType: { document: 1 } };
const renderedBody: RenderOutcome = { kind: "rendered", html: "<p>Body</p>", finalUrl: URL, httpStatus: 200, requests };
const directBlock: RenderOutcome = { kind: "blocked", httpStatus: 403, requests };
const directFailure: TerminalRenderOutcome = { kind: "failed", detail: "no main document response", requests };
const proxiedFailure: RenderOutcome = { kind: "failed", detail: "proxied timeout", requests };

function ladderWith(script: {
	direct: RenderOutcome;
	proxied?: RenderOutcome;
	proxiedFetch?: ProxiedFetchAttempt;
	budgetAllowed?: boolean;
	unsupportedReason?: "javascript-required" | "blocked";
}) {
	const steps: string[] = [];
	const renderPage: RenderPage = async (params) => {
		steps.push(params.proxy === undefined ? `direct render ${params.navigationTimeoutMilliseconds}` : `proxied render ${params.navigationTimeoutMilliseconds}`);
		if (params.proxy === undefined) return script.direct;
		if (script.proxied === undefined) throw new Error("the proxied render was not expected to run");
		return script.proxied;
	};
	const legs = {
			renderPage,
			url: URL,
			proxy: residentialProxy,
			unsupportedReason: script.unsupportedReason ?? "javascript-required",
			fetchThroughProxy: async () => {
				steps.push("proxied fetch");
				if (script.proxiedFetch === undefined) throw new Error("the proxied fetch was not expected to run");
				return script.proxiedFetch;
			},
			consumeBudget: async () => {
				steps.push("budget");
				return { allowed: script.budgetAllowed ?? true };
			},
	};
	return { run: () => runRenderLadder(legs), escalateFrom: (direct: TerminalRenderOutcome) => escalateThroughProxy({ ...legs, direct }), steps };
}

describe("runRenderLadder", () => {
	it("serves the direct render with no budget and no proxy", async () => {
		const { run, steps } = ladderWith({ direct: renderedBody });

		const result = await run();

		expect(result).toEqual({ ...renderedBody, renderedThrough: "direct-egress" });
		expect(steps).toEqual(["direct render 30000"]);
	});

	it("stops at a readable proxied fetch with no render budget and no proxied render", async () => {
		const { run, steps } = ladderWith({ direct: directBlock, proxiedFetch: { kind: "committed" } });

		const result = await run();

		expect(result).toEqual({ kind: "fetched-through-proxy" });
		expect(steps).toEqual(["direct render 30000", "proxied fetch"]);
	});

	it.each(["javascript-required", "blocked", "not-found", "failed"])("reaches the proxied render after the proxied fetch ends %s", async (outcome) => {
		const { run, steps } = ladderWith({
			direct: directBlock,
			proxiedFetch: { kind: "no-body", outcome },
			proxied: renderedBody,
		});

		const result = await run();

		expect(result).toEqual({ ...renderedBody, renderedThrough: "residential-proxy" });
		expect(steps).toEqual(["direct render 30000", "proxied fetch", "budget", "proxied render 90000"]);
	});

	it("spends no budget and runs no proxied render when the proxied fetch settled the save itself", async () => {
		const { run, steps } = ladderWith({ direct: directBlock, proxiedFetch: { kind: "settled" } });

		const result = await run();

		expect(result).toEqual({ kind: "settled-by-proxied-fetch" });
		expect(steps).toEqual(["direct render 30000", "proxied fetch"]);
	});

	it("runs the proxied fetch before the budget when a blocked deferral's direct render failed", async () => {
		const { run, steps } = ladderWith({ unsupportedReason: "blocked", direct: directFailure, proxiedFetch: { kind: "committed" } });

		const result = await run();

		expect(result).toEqual({ kind: "fetched-through-proxy" });
		expect(steps).toEqual(["direct render 30000", "proxied fetch"]);
	});

	it("runs the proxied fetch from an unreadable direct render on a blocked deferral", async () => {
		const { escalateFrom, steps } = ladderWith({ unsupportedReason: "blocked", direct: renderedBody, proxiedFetch: { kind: "no-body", outcome: "blocked" }, proxied: renderedBody });

		const result = await escalateFrom(directFailure);

		expect(result).toEqual({ ...renderedBody, renderedThrough: "residential-proxy" });
		expect(steps).toEqual(["proxied fetch", "budget", "proxied render 90000"]);
	});

	it("skips the proxied fetch when the direct render of a javascript-required page failed", async () => {
		const { run, steps } = ladderWith({ direct: directFailure, proxied: renderedBody });

		await run();

		expect(steps).toEqual(["direct render 30000", "budget", "proxied render 90000"]);
	});

	it("never runs the proxied render when the budget is exhausted after the proxied fetch", async () => {
		const proxiedFetch: ProxiedFetchAttempt = { kind: "no-body", outcome: "blocked" };
		const { run, steps } = ladderWith({ direct: directBlock, proxiedFetch, budgetAllowed: false });

		const result = await run();

		expect(result).toEqual({ kind: "budget-exhausted", direct: directBlock, proxiedFetch });
		expect(steps).toEqual(["direct render 30000", "proxied fetch", "budget"]);
	});

	it("reports both render outcomes and the proxied fetch when nothing rendered", async () => {
		const proxiedFetch: ProxiedFetchAttempt = { kind: "no-body", outcome: "blocked" };
		const { run } = ladderWith({ direct: directBlock, proxiedFetch, proxied: proxiedFailure });

		const result = await run();

		expect(result).toEqual({ kind: "unrendered", direct: directBlock, proxied: proxiedFailure, proxiedFetch });
	});

	it("reports that no proxied fetch ran after a direct failure", async () => {
		const { run } = ladderWith({ direct: directFailure, proxied: proxiedFailure });

		const result = await run();

		expect(result).toEqual({ kind: "unrendered", direct: directFailure, proxied: proxiedFailure, proxiedFetch: { kind: "not-attempted" } });
	});
});
