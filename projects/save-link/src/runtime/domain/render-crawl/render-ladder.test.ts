import type { RenderOutcome, RenderPage, RenderProxy } from "../../providers/render-page/render-page.types";
import { runRenderLadder } from "./render-ladder";

const URL = "https://example-spa.test/post";
const residentialProxy: RenderProxy = { server: "http://proxy.example.test:22225", username: "zone-user", password: "zone-secret" };

function scriptedRenderPage(outcomes: { direct: RenderOutcome; proxied?: RenderOutcome }) {
	const calls: Parameters<RenderPage>[0][] = [];
	const renderPage: RenderPage = async (params) => {
		calls.push(params);
		if (params.proxy === undefined) return outcomes.direct;
		if (outcomes.proxied === undefined) throw new Error("the proxied leg was not expected to run");
		return outcomes.proxied;
	};
	return { renderPage, calls };
}

describe("runRenderLadder", () => {
	it("serves the direct render without reaching the residential proxy", async () => {
		const { renderPage, calls } = scriptedRenderPage({
			direct: { kind: "rendered", html: "<p>Rendered body</p>", finalUrl: URL, httpStatus: 200 },
		});

		const result = await runRenderLadder({ renderPage, url: URL, proxy: residentialProxy });

		expect(result).toEqual({
			kind: "rendered",
			html: "<p>Rendered body</p>",
			finalUrl: URL,
			httpStatus: 200,
			renderedThrough: "direct-egress",
		});
		expect(calls).toEqual([{ url: URL, navigationTimeoutMilliseconds: 30_000 }]);
	});

	it("renders through the residential proxy when the direct render is blocked", async () => {
		const { renderPage, calls } = scriptedRenderPage({
			direct: { kind: "blocked", httpStatus: 403 },
			proxied: { kind: "rendered", html: "<p>Proxied body</p>", finalUrl: `${URL}/`, httpStatus: 200 },
		});

		const result = await runRenderLadder({ renderPage, url: URL, proxy: residentialProxy });

		expect(result).toEqual({
			kind: "rendered",
			html: "<p>Proxied body</p>",
			finalUrl: `${URL}/`,
			httpStatus: 200,
			renderedThrough: "residential-proxy",
		});
		expect(calls).toEqual([
			{ url: URL, navigationTimeoutMilliseconds: 30_000 },
			{ url: URL, proxy: residentialProxy, navigationTimeoutMilliseconds: 90_000 },
		]);
	});

	it("renders through the residential proxy when the direct render fails", async () => {
		const { renderPage } = scriptedRenderPage({
			direct: { kind: "failed", detail: "net::ERR_CONNECTION_RESET" },
			proxied: { kind: "rendered", html: "<p>Proxied body</p>", finalUrl: URL, httpStatus: 200 },
		});

		const result = await runRenderLadder({ renderPage, url: URL, proxy: residentialProxy });

		expect(result).toEqual({
			kind: "rendered",
			html: "<p>Proxied body</p>",
			finalUrl: URL,
			httpStatus: 200,
			renderedThrough: "residential-proxy",
		});
	});

	it("returns both terminal outcomes when both legs are blocked", async () => {
		const { renderPage } = scriptedRenderPage({
			direct: { kind: "blocked", httpStatus: 403 },
			proxied: { kind: "blocked", httpStatus: 429 },
		});

		const result = await runRenderLadder({ renderPage, url: URL, proxy: residentialProxy });

		expect(result).toEqual({
			kind: "unrendered",
			direct: { kind: "blocked", httpStatus: 403 },
			proxied: { kind: "blocked", httpStatus: 429 },
		});
	});

	it("returns both terminal outcomes when both legs fail", async () => {
		const { renderPage } = scriptedRenderPage({
			direct: { kind: "failed", detail: "main document answered HTTP 500", httpStatus: 500 },
			proxied: { kind: "failed", detail: "Navigation failed because browser has disconnected!" },
		});

		const result = await runRenderLadder({ renderPage, url: URL, proxy: residentialProxy });

		expect(result).toEqual({
			kind: "unrendered",
			direct: { kind: "failed", detail: "main document answered HTTP 500", httpStatus: 500 },
			proxied: { kind: "failed", detail: "Navigation failed because browser has disconnected!" },
		});
	});
});
