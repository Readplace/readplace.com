import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { MinutesSchema, type SaveProvenance } from "@packages/domain/article";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { type NewsletterCatalogRecord, NewsletterNameSchema } from "@packages/domain/newsletter-catalog";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryNewsletterCatalog } from "@packages/test-fixtures/providers/newsletter-catalog";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const AT = "2026-09-30T00:00:00.000Z";
const NAMED_SENDER = "dan@tldr.tech";
const UNNAMED_SENDER = "stranger@example.com";
const TLDR: NewsletterCatalogRecord = {
	from: ForwardableSenderSchema.parse(NAMED_SENDER),
	name: NewsletterNameSchema.parse("TLDR"),
	status: "approved",
	evidence: [],
	createdAt: AT,
	updatedAt: AT,
};

const FROM_TLDR = "https://example.com/from-tldr";
const FROM_THE_WEB = "https://example.com/from-the-web";
const SAVES: { url: string; provenance: SaveProvenance }[] = [
	{ url: FROM_TLDR, provenance: { kind: "email", senderEmail: NAMED_SENDER } },
	{ url: "https://example.com/from-tldr-again", provenance: { kind: "email", senderEmail: ` ${NAMED_SENDER.toUpperCase()} ` } },
	{ url: "https://example.com/from-a-stranger", provenance: { kind: "email", senderEmail: UNNAMED_SENDER } },
	{ url: FROM_THE_WEB, provenance: { kind: "web" } },
];

interface ViaFact {
	tag: string;
	text: string;
	title: string | null;
	empty: boolean;
	sender: string[] | undefined;
	fallback: { text: string; title: string | null; hiddenUnderPopover: boolean };
}

function viaOf(card: Element): ViaFact {
	const via = card.querySelector("[data-test-article-via]");
	assert(via, "every card renders its via fact");
	const fallback = card.querySelector("[data-test-article-via-fallback]");
	assert(fallback, "every card renders the plain via fact a browser without popovers shows");
	const popoverId = via.getAttribute("popovertarget");
	const sender = popoverId === null ? null : card.ownerDocument.getElementById(popoverId);
	return {
		tag: via.tagName.toLowerCase(),
		text: via.textContent?.trim() ?? "",
		title: via.getAttribute("title"),
		empty: via.classList.contains("readlist-article__via--empty"),
		sender: sender === null ? undefined : Array.from(sender.children, (line) => line.textContent ?? ""),
		fallback: {
			text: fallback.textContent?.trim() ?? "",
			title: fallback.getAttribute("title"),
			hiddenUnderPopover: fallback.classList.contains("sender-popover__fallback"),
		},
	};
}

function cardFor(html: string, url: string): Element {
	const site = new JSDOM(html).window.document.querySelector(`[data-test-article-url][href="${url}"]`);
	const card = site?.closest(".readlist-article");
	assert(card, `the card for ${url} must be rendered`);
	return card;
}

const NAMED: ViaFact = {
	tag: "button",
	text: "via TLDR",
	title: NAMED_SENDER,
	empty: false,
	sender: ["TLDR", NAMED_SENDER],
	fallback: { text: "via TLDR", title: NAMED_SENDER, hiddenUnderPopover: true },
};
function addressedBy(sender: string): ViaFact {
	return {
		tag: "span",
		text: `via ${sender}`,
		title: `via ${sender}`,
		empty: false,
		sender: undefined,
		fallback: { text: `via ${sender}`, title: `via ${sender}`, hiddenUnderPopover: false },
	};
}
const NONE: ViaFact = {
	tag: "span",
	text: "",
	title: "",
	empty: true,
	sender: undefined,
	fallback: { text: "", title: "", hiddenUnderPopover: false },
};

async function readlistWithEmailedSaves(records: readonly NewsletterCatalogRecord[]) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const catalog = initInMemoryNewsletterCatalog({ version: 1, records: [...records] });
	const catalogReads: number[] = [];
	const harness = useApp({
		...fixture,
		newsletterCatalog: {
			...fixture.newsletterCatalog,
			readNewsletterCatalog: async () => {
				catalogReads.push(1);
				return catalog.readCatalog();
			},
		},
	});
	const agent = await loginAgent(harness.server, harness.auth);
	const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
	assert(userId, "the seeded login user must exist");
	const ids = new Map<string, string>();
	for (const save of SAVES) {
		const { saved } = await harness.articleStore.saveArticle({
			userId,
			url: save.url,
			metadata: { title: `Saved ${save.url}`, siteName: "example.com", excerpt: "", wordCount: 0 },
			estimatedReadTime: MinutesSchema.parse(0),
			provenance: save.provenance,
			savedAt: new Date(),
		});
		ids.set(save.url, saved.id.value);
	}
	return {
		agent,
		catalog,
		cardId: (url: string): string => {
			const id = ids.get(url);
			assert(id, `the save of ${url} must have an id`);
			return id;
		},
		catalogReads: () => catalogReads.length,
	};
}

describe("Readlist card via fact", () => {
	it("marks every emailed save on the listing with who it came from, naming a catalogued sender and keeping its address on hover and behind a tap", async () => {
		const { agent, catalogReads } = await readlistWithEmailedSaves([TLDR]);

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		expect(SAVES.map((save) => viaOf(cardFor(response.text, save.url)))).toEqual([
			NAMED,
			NAMED,
			addressedBy(UNNAMED_SENDER),
			NONE,
		]);
		expect(catalogReads()).toBe(1);
	});

	it("keeps the same via on the fragment a card polls for, so a card that stops polling keeps its label", async () => {
		const { agent, cardId, catalogReads } = await readlistWithEmailedSaves([TLDR]);

		const fragments = await Promise.all(
			SAVES.map(async (save): Promise<string> => {
				const response = await agent.get(`/queue/${cardId(save.url)}/card?poll=1`);
				expect(response.status).toBe(200);
				return response.text;
			}),
		);

		expect(fragments.map((html, index) => viaOf(cardFor(html, SAVES[index].url)))).toEqual([
			NAMED,
			NAMED,
			addressedBy(UNNAMED_SENDER),
			NONE,
		]);
		expect(catalogReads()).toBe(SAVES.length - 1);
	});

	it("answers a polling card's revalidation with the sender's name once the catalogue approves it, while a web card whose tag has not moved still answers 304", async () => {
		const { agent, catalog, cardId } = await readlistWithEmailedSaves([]);
		const emailed = cardId(FROM_TLDR);
		const web = cardId(FROM_THE_WEB);
		const [addressed, webCard] = await Promise.all([
			agent.get(`/queue/${emailed}/card?poll=1`),
			agent.get(`/queue/${web}/card?poll=1`),
		]);
		expect(viaOf(cardFor(addressed.text, FROM_TLDR))).toEqual(addressedBy(NAMED_SENDER));
		const addressedEtag = addressed.headers.etag;
		assert(addressedEtag, "the addressed card must carry an ETag");
		const webEtag = webCard.headers.etag;
		assert(webEtag, "the web card must carry an ETag");
		const before = await catalog.readCatalog();
		assert(before.ok, "the catalogue must be readable before the sender is approved");
		const approved = await catalog.writeCatalog({
			expectedEtag: before.etag,
			document: { version: 1, records: [TLDR] },
		});
		assert(approved.ok, "approving the sender must land in the catalogue");

		const [named, unchanged] = await Promise.all([
			agent.get(`/queue/${emailed}/card?poll=2`).set("If-None-Match", addressedEtag),
			agent.get(`/queue/${web}/card?poll=2`).set("If-None-Match", webEtag),
		]);

		expect(named.status).toBe(200);
		expect(viaOf(cardFor(named.text, FROM_TLDR))).toEqual(NAMED);
		expect([unchanged.status, unchanged.text, unchanged.headers.etag]).toEqual([304, "", webEtag]);
	});
});
