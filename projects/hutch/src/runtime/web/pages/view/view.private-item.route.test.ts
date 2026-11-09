import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { calculateReadTime, ReaderArticleHashId } from "@packages/domain/article";
import { createDefaultTestAppFixture, TEST_APP_ORIGIN } from "@packages/test-fixtures";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const PRIVATE_VIEW_PATH = "/view/uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const ORDINARY_URL = "https://example.com/post";
const PRIVATE_BODY = "<p>PRIVATE-BOOK-BODY</p>";

const useApp = useTestServer();

async function seedPrivateUpload() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const owner = await harness.auth.createUser({ email: "owner@example.com", password: "password123" });
	assert(owner.ok, "owner should be created");
	await harness.auth.createUser({ email: "other@example.com", password: "password123" });
	await fixture.articleStore.saveArticle({
		userId: owner.userId,
		url: PRIVATE_URL,
		metadata: { title: "A private book", siteName: "Private press", excerpt: "PRIVATE-EXCERPT", wordCount: 3 },
		estimatedReadTime: calculateReadTime(3),
		provenance: { kind: "web" },
		savedAt: new Date("2026-09-01T00:00:00.000Z"),
	});
	await fixture.articleStore.writeContent({ url: PRIVATE_URL, content: PRIVATE_BODY });
	await fixture.articleCrawl.markCrawlReady({ url: PRIVATE_URL });
	await fixture.articleStore.recordItemOwner({ url: PRIVATE_URL, ownerUserId: owner.userId });
	return { harness, fixture };
}

async function signIn(harness: Awaited<ReturnType<typeof seedPrivateUpload>>["harness"], email: string) {
	const agent = request.agent(harness.server);
	await agent.post("/login").set(BROWSER_REQUEST_HEADERS).type("form").send({ email, password: "password123" });
	return agent;
}

type Reader = "signed-out" | "other";

async function getAs(params: { reader: Reader; path: string }) {
	const { harness } = await seedPrivateUpload();
	if (params.reader === "signed-out") return request(harness.server).get(params.path).set(BROWSER_REQUEST_HEADERS);
	const agent = await signIn(harness, "other@example.com");
	return agent.get(params.path).set(BROWSER_REQUEST_HEADERS);
}

function readerStatusOf(html: string): string | null | undefined {
	return new JSDOM(html).window.document.querySelector("[data-test-reader-slot]")?.getAttribute("data-reader-status");
}

describe("/view for a private upload", () => {
	it.each<Reader>(["signed-out", "other"])("shows a %s reader the stub, with no body, save or EPUB export", async (reader) => {
		const response = await getAs({ reader, path: PRIVATE_VIEW_PATH });

		expect(response.status).toBe(200);
		const leaks = ["PRIVATE-BOOK-BODY", "A private book", "PRIVATE-EXCERPT", "Private press", "Save to My Readlist", "format=epub"];
		expect(leaks.filter((marker) => response.text.includes(marker))).toEqual([]);
	});

	it("shows the owner the body but offers no Save to My Readlist", async () => {
		const { harness } = await seedPrivateUpload();
		const agent = await signIn(harness, "owner@example.com");

		const response = await agent.get(PRIVATE_VIEW_PATH).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(response.text).toContain("PRIVATE-BOOK-BODY");
		expect(response.text).not.toContain("Save to My Readlist");
		const doc = new JSDOM(response.text).window.document;
		expect([
			doc.querySelectorAll('[data-test-action="share-open"]').length,
			doc.querySelectorAll("[data-share-url]").length,
			doc.querySelectorAll('a[href*=".invalid"]:not([href*="format=epub"])').length,
		]).toEqual([0, 0, 0]);
	});
});

describe("/view polls for a private upload", () => {
	const encoded = encodeURIComponent(PRIVATE_URL);

	it.each<[Reader, string]>([
		["signed-out", `/view/reader?url=${encoded}&poll=1`],
		["signed-out", `/view/summary?url=${encoded}&poll=1`],
		["other", `/view/reader?url=${encoded}&poll=1`],
		["other", `/view/summary?url=${encoded}&poll=1`],
	])("answers a %s reader's %s with the not-an-article fragment", async (reader, path) => {
		const response = await getAs({ reader, path });

		expect(readerStatusOf(response.text)).toBe("not-an-article");
		expect(response.text).not.toContain("PRIVATE-BOOK-BODY");
		expect(response.text).not.toContain("A private book");
	});

	it("gives the owner's /queue/:id reader poll the body and the upload's own title", async () => {
		const { harness } = await seedPrivateUpload();
		const agent = await signIn(harness, "owner@example.com");
		const id = ReaderArticleHashId.from(PRIVATE_URL).value;

		const response = await agent.get(`/queue/${id}/reader?poll=1`).set(BROWSER_REQUEST_HEADERS);

		const doc = new JSDOM(response.text).window.document;
		expect(response.text).toContain("PRIVATE-BOOK-BODY");
		expect(doc.querySelector("title")?.textContent).toContain("A private book");
		expect(response.text).not.toContain("Private upload");
	});

	it("still renders an ordinary article's body on a /view/reader poll", async () => {
		const { harness, fixture } = await seedPrivateUpload();
		await fixture.articleStore.saveArticleGlobally({
			url: ORDINARY_URL,
			metadata: { title: "Hello", siteName: "example.com", excerpt: "x", wordCount: 3 },
			estimatedReadTime: calculateReadTime(3),
			savedAt: new Date("2026-09-02T00:00:00.000Z"),
		});
		await fixture.articleStore.writeContent({ url: ORDINARY_URL, content: "<p>ORDINARY-BODY</p>" });
		await fixture.articleCrawl.markCrawlReady({ url: ORDINARY_URL });

		const response = await request(harness.server)
			.get(`/view/reader?url=${encodeURIComponent(ORDINARY_URL)}&poll=1`)
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.text).toContain("ORDINARY-BODY");
	});
});
