import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { describeUntrackedCtas, findUntrackedCtas } from "@packages/web-test-harness";
import { BROWSER_REQUEST_HEADERS, loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();

const ARTICLE_CONTENT_REGIONS = [
	"[data-test-reader-content]",
	// The past-reads compute triggers fire automatically on load rather than on a
	// reader click, so tagging them would count a click on every reader open.
	".past-reads__request",
];

const GUEST_PATHS = [
	"/",
	"/login",
	"/signup",
	"/forgot-password",
	"/install",
	"/install?client=chrome",
	"/install?client=iphone",
	"/install?client=chatgpt",
	"/install?client=gemini",
	"/install?client=claude",
	"/import",
	"/privacy",
	"/terms",
	"/support",
	"/help/add-links",
	"/mcp",
	"/pocket-alternative",
	"/pdf-ocr",
	"/ai-reading-list",
	"/read-it-later-that-wont-die",
	"/queue",
	"/save",
	"/view/not-a-url",
	"/no-such-page",
];

const MEMBER_PATHS = [
	"/queue",
	"/queue?tab=done",
	"/queue?q=article",
	"/account",
	"/account?section=subscription",
	"/export",
	"/install",
	"/install?client=chrome",
	"/install?client=iphone",
	"/install?client=chatgpt",
	"/install?client=gemini",
	"/install?client=claude",
	"/import",
	"/import?mode=upload",
	"/integrations",
	"/mcp",
	"/save",
	"/view/not-a-url",
	"/no-such-page",
];

function untrackedOn(path: string, html: string): string[] {
	return describeUntrackedCtas(
		findUntrackedCtas(html, { skipSelectors: ARTICLE_CONTENT_REGIONS }),
	).map((line) => `${path}  ${line}`);
}

describe("every same-origin CTA carries its own utm_source", () => {
	it("holds across the logged-out funnel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const untracked: string[] = [];
		for (const path of GUEST_PATHS) {
			const response = await request(harness.server).get(path).set(BROWSER_REQUEST_HEADERS);
			untracked.push(...untrackedOn(path, response.text));
		}

		expect(untracked).toEqual([]);
	});

	it("holds across the signed-in surfaces, including the reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });
		const queue = await agent.get("/queue").set(BROWSER_REQUEST_HEADERS);
		const readerHref = new JSDOM(queue.text).window.document
			.querySelector("[data-test-article-title]")
			?.getAttribute("href");
		const madeReadlist = new URL(
			(await agent.post("/queue/queues")).headers.location,
			TEST_APP_ORIGIN,
		).searchParams.get("queue");
		const readlistPaths = madeReadlist
			? [`/queue/queues/${madeReadlist}/preferences?feature=pref`]
			: [];

		const untracked: string[] = [];
		for (const path of [
			...MEMBER_PATHS,
			...readlistPaths,
			...(readerHref ? [readerHref] : []),
		]) {
			const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);
			untracked.push(...untrackedOn(path, response.text));
		}

		expect(readerHref).toContain("/view");
		expect(readlistPaths.length).toBe(1);
		expect(untracked).toEqual([]);
	});
});
