import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { createDefaultTestAppFixture, TEST_APP_ORIGIN } from "@packages/test-fixtures";
import { iconSvg } from "@packages/ui-icons";
import { MAX_POLLS } from "@packages/web-shell";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const BOOK_ID = ReaderArticleHashId.from(PRIVATE_URL).value;

const useApp = useTestServer();

async function signInAsOwnerOfBook() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const owner = await harness.auth.createUser({ email: "owner@example.com", password: "password123" });
	assert(owner.ok, "owner should be created");
	await fixture.articleStore.savePrivateItem({
		url: PRIVATE_URL,
		ownerUserId: owner.userId,
		media: { kind: "book", fileName: "dune.epub" },
		savedAt: new Date("2026-11-05T00:00:00.000Z"),
	});
	const agent = request.agent(harness.server);
	await agent
		.post("/login")
		.set(BROWSER_REQUEST_HEADERS)
		.type("form")
		.send({ email: "owner@example.com", password: "password123" });
	return { fixture, agent };
}

async function commitBook(fixture: ReturnType<typeof createDefaultTestAppFixture>) {
	await fixture.articleStore.recordPrivateItemSections({ url: PRIVATE_URL, sectionCount: 23 });
	await fixture.articleStore.writeMetadata({
		url: PRIVATE_URL,
		metadata: { title: "Dune", siteName: "Book", excerpt: "A desert planet.", wordCount: 139_200 },
		estimatedReadTime: MinutesSchema.parse(580),
	});
	await fixture.articleStore.writeContent({ url: PRIVATE_URL, content: '<h2 id="section-1">One</h2><p>Arrakis.</p>' });
	await fixture.articleCrawl.markCrawlReady({ url: PRIVATE_URL });
}

function bookCardIn(html: string): Element {
	const card = new JSDOM(html).window.document.querySelector(`[data-test-article="${BOOK_ID}"]`);
	assert(card, "the book card must be rendered");
	return card;
}

describe("a book card on the readlist", () => {
	it("shows the Book badge and the book's pending copy while it is prepared", async () => {
		const { agent } = await signInAsOwnerOfBook();

		const card = bookCardIn((await agent.get("/queue").set(BROWSER_REQUEST_HEADERS)).text);

		expect(card.querySelector("[data-test-article-kind]")?.getAttribute("data-test-article-kind")).toBe("book");
		expect(card.querySelector("[data-test-article-kind]")?.textContent?.trim()).toBe("Book");
		expect(card.querySelector("[data-test-processing-label]")?.textContent?.trim()).toBe("Preparing your book…");
	});

	it("labels a committed book with its chapters and its read time in hours and minutes", async () => {
		const { fixture, agent } = await signInAsOwnerOfBook();
		await commitBook(fixture);

		const card = bookCardIn((await agent.get("/queue").set(BROWSER_REQUEST_HEADERS)).text);

		expect(card.querySelector("[data-test-read-time]")?.textContent?.trim()).toBe("Book · 23 chapters · 9 h 40 min read");
	});

	it("names the book as its site without linking to an origin it does not have", async () => {
		const { agent } = await signInAsOwnerOfBook();

		const card = bookCardIn((await agent.get("/queue").set(BROWSER_REQUEST_HEADERS)).text);

		expect(card.querySelector("[data-test-article-site-text]")?.textContent?.trim()).toBe("Book");
		expect(card.querySelector("[data-test-article-url]")).toBeNull();
	});

	it("tells the reader the book is still being prepared once the card stops polling, with no link", async () => {
		const { agent } = await signInAsOwnerOfBook();

		const card = bookCardIn((await agent.get(`/queue/${BOOK_ID}/card?poll=${MAX_POLLS + 1}`).set(BROWSER_REQUEST_HEADERS)).text);

		const stale = card.querySelector("[data-test-stale-pending]");
		expect(stale?.textContent?.trim()).toBe("Taking a while — we're still preparing this book.");
		expect(stale?.querySelector("a")).toBeNull();
	});

	it("keeps an ordinary article's site link and its stale-pending link to the source", async () => {
		const { agent } = await signInAsOwnerOfBook();
		await agent.post("/queue/save").set(BROWSER_REQUEST_HEADERS).type("form").send({ url: "https://example.com/ordinary" });
		const list = new JSDOM((await agent.get("/queue").set(BROWSER_REQUEST_HEADERS)).text).window.document;
		const ordinaryId = [...list.querySelectorAll("[data-test-article]")]
			.map((card) => card.getAttribute("data-test-article"))
			.find((id) => id !== BOOK_ID);
		assert(ordinaryId, "the ordinary article must be rendered");

		const response = await agent.get(`/queue/${ordinaryId}/card?poll=${MAX_POLLS + 1}`).set(BROWSER_REQUEST_HEADERS);

		const card = new JSDOM(response.text).window.document;
		expect(card.querySelector("[data-test-article-url]")?.getAttribute("href")).toBe("https://example.com/ordinary");
		expect(card.querySelector("[data-test-stale-pending] a")?.getAttribute("href")).toBe("https://example.com/ordinary");
		expect(card.querySelector("[data-test-article-kind]")).toBeNull();
	});
});

describe("a book in the reader", () => {
	function readerFactsIn(html: string): (string | null)[] {
		const doc = new JSDOM(html).window.document;
		return [...doc.querySelectorAll("[data-test-reader-fact]")].map((fact) => fact.getAttribute("data-test-reader-fact"));
	}

	it("lists the book's facts without an Original link", async () => {
		const { fixture, agent } = await signInAsOwnerOfBook();
		await commitBook(fixture);

		const response = await agent.get(`/queue/${BOOK_ID}/view`).set(BROWSER_REQUEST_HEADERS);

		expect(readerFactsIn(response.text)).toEqual(["site", "saved", "read-time", "provenance"]);
	});

	it("offers the owner no share link to a private book", async () => {
		const { fixture, agent } = await signInAsOwnerOfBook();
		await commitBook(fixture);

		const response = await agent.get(`/queue/${BOOK_ID}/view`).set(BROWSER_REQUEST_HEADERS);

		const doc = new JSDOM(response.text).window.document;
		expect([
			doc.querySelectorAll('a[href*=".invalid"]').length,
			doc.querySelectorAll("[data-share-url]").length,
			doc.querySelectorAll('[data-test-action="share-withheld"]').length,
		]).toEqual([0, 0, 1]);
	});

	it("lists an ordinary article's facts ending with its Original link", async () => {
		const { agent } = await signInAsOwnerOfBook();
		await agent.post("/queue/save").set(BROWSER_REQUEST_HEADERS).type("form").send({ url: "https://example.com/ordinary" });
		const id = ReaderArticleHashId.from("https://example.com/ordinary").value;

		const response = await agent.get(`/queue/${id}/view`).set(BROWSER_REQUEST_HEADERS);

		expect(readerFactsIn(response.text)).toContain("original");
	});
});

describe("a video card on the readlist", () => {
	it("shows the Video badge with the video icon", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const owner = await harness.auth.createUser({ email: "owner@example.com", password: "password123" });
		assert(owner.ok, "owner should be created");
		await fixture.articleStore.savePrivateItem({
			url: PRIVATE_URL,
			ownerUserId: owner.userId,
			media: { kind: "video", fileName: "talk.mp4" },
			savedAt: new Date("2026-11-05T00:00:00.000Z"),
		});
		const agent = request.agent(harness.server);
		await agent
			.post("/login")
			.set(BROWSER_REQUEST_HEADERS)
			.type("form")
			.send({ email: "owner@example.com", password: "password123" });

		const badge = bookCardIn((await agent.get("/queue").set(BROWSER_REQUEST_HEADERS)).text).querySelector(
			"[data-test-article-kind]",
		);

		expect(badge?.getAttribute("data-test-article-kind")).toBe("video");
		expect(badge?.textContent?.trim()).toBe("Video");
		expect(badge?.querySelector("svg")?.outerHTML).toBe(JSDOM.fragment(iconSvg("video")).firstElementChild?.outerHTML);
	});
});
