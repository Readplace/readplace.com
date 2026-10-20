import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { calculateReadTime } from "@packages/domain/article";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture, createFakeSummaryProvider } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { saveAccessTokenForUser } from "../../test-helpers/oauth-token";

const WEBMAIL_URL = "https://mail.google.com/mail/u/2/";
const ORDINARY_URL = "https://example.com/ordinary";
const PRIVATE_MARKERS = [
	"private.person@example.com",
	"PRIVATE-INBOX-BODY",
	"PRIVATE-SUMMARY",
	"PRIVATE-PARSED-EXCERPT",
	"private-avatar",
];

const useApp = useTestServer();

function markersIn(text: string): string[] {
	return PRIVATE_MARKERS.filter((marker) => text.includes(marker));
}

async function coSaverOfAWebmailPage() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const summary = createFakeSummaryProvider();
	const harness = useApp({ ...fixture, summary });
	await fixture.articleStore.saveArticleGlobally({
		url: WEBMAIL_URL,
		metadata: {
			title: "Inbox (12) - private.person@example.com",
			siteName: "mail.google.com",
			excerpt: "PRIVATE-PARSED-EXCERPT",
			wordCount: 9,
			imageUrl: "https://cdn.readplace.test/media/private-avatar.png",
		},
		estimatedReadTime: calculateReadTime(9),
		savedAt: new Date("2026-08-01T00:00:00.000Z"),
	});
	await fixture.articleStore.writeContent({ url: WEBMAIL_URL, content: "<p>PRIVATE-INBOX-BODY</p>" });
	summary.markSummaryReady({ url: WEBMAIL_URL, summary: "PRIVATE-SUMMARY of the inbox", excerpt: "PRIVATE-SUMMARY-EXCERPT" });
	await fixture.articleStore.saveArticleGlobally({
		url: ORDINARY_URL,
		metadata: { title: "An ordinary post", siteName: "example.com", excerpt: "An ordinary excerpt", wordCount: 400 },
		estimatedReadTime: calculateReadTime(400),
		savedAt: new Date("2026-08-01T00:00:00.000Z"),
	});
	await fixture.articleStore.writeContent({ url: ORDINARY_URL, content: "<p>An ordinary body.</p>" });

	const created = await harness.auth.createUser({ email: "cosaver@example.com", password: "password123" });
	assert(created.ok, "the co-saver must be created");
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email: "cosaver@example.com", password: "password123" });
	await agent.post("/queue/save").type("form").send({ url: WEBMAIL_URL });
	await agent.post("/queue/save").type("form").send({ url: ORDINARY_URL });
	return { harness, agent, userId: created.userId };
}

function cardFor(doc: Document, url: string): Element {
	const card = Array.from(doc.querySelectorAll("[data-test-article-list] .readlist-article")).find(
		(candidate) => candidate.querySelector("[data-test-article-url]")?.getAttribute("href") === url,
	);
	assert(card, `the readlist must show a card for ${url}`);
	return card;
}

describe("a co-saver of a webmail page", () => {
	it("sees only the host on the webmail card", async () => {
		const { agent } = await coSaverOfAWebmailPage();

		const doc = new JSDOM((await agent.get("/queue")).text).window.document;
		const webmail = cardFor(doc, WEBMAIL_URL);
		const ordinary = cardFor(doc, ORDINARY_URL);

		expect(markersIn(webmail.outerHTML)).toEqual([]);
		expect(webmail.querySelector("[data-test-article-title]")?.textContent).toBe("mail.google.com");
		expect(webmail.querySelector("[data-test-article-url] .readlist-article__site-name")?.textContent).toBe(
			"mail.google.com",
		);
		expect(
			webmail.querySelector("[data-test-read-time]")?.classList.contains("readlist-article__read-time--empty"),
		).toBe(true);
		expect(webmail.querySelectorAll("[data-test-article-excerpt]")).toHaveLength(0);
		expect(ordinary.querySelectorAll("[data-test-article-excerpt]")).toHaveLength(1);
	});

	it("sees only the host in the webmail entity of the Siren readlist", async () => {
		const { harness, userId } = await coSaverOfAWebmailPage();
		const token = await saveAccessTokenForUser(harness, userId);

		const response = await request(harness.server)
			.get("/queue")
			.set("Authorization", `Bearer ${token}`)
			.set("Accept", SIREN_MEDIA_TYPE);

		expect(markersIn(response.text)).toEqual([]);
		const entity = response.body.entities.find(
			(candidate: { properties: { url: string } }) => candidate.properties.url === WEBMAIL_URL,
		);
		expect(entity.properties).toMatchObject({
			title: "mail.google.com",
			siteName: "mail.google.com",
			excerpt: "",
			imageUrl: null,
			readTime: null,
		});
	});
});
