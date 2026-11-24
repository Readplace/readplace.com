import assert from "node:assert/strict";
import request from "supertest";
import { MinutesSchema, type SaveProvenance } from "@packages/domain/article";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { type NewsletterCatalogRecord, NewsletterNameSchema } from "@packages/domain/newsletter-catalog";
import { UserIdSchema } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryNewsletterCatalog } from "@packages/test-fixtures/providers/newsletter-catalog";
import { z } from "zod";
import { useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { createAccessToken } from "../../test-helpers/oauth-token";

const useApp = useTestServer();

const USER_ID = UserIdSchema.parse("test-user-123");
const AT = "2026-09-30T00:00:00.000Z";
const NAMED_SENDER = "dan@tldr.tech";
const TLDR: NewsletterCatalogRecord = {
	from: ForwardableSenderSchema.parse(NAMED_SENDER),
	name: NewsletterNameSchema.parse("TLDR"),
	status: "approved",
	evidence: [],
	createdAt: AT,
	updatedAt: AT,
};

const FROM_TLDR = "https://example.com/from-tldr";
const FROM_A_STRANGER = "https://example.com/from-a-stranger";
const FROM_THE_WEB = "https://example.com/from-the-web";
const SAVES: { url: string; provenance: SaveProvenance }[] = [
	{ url: FROM_TLDR, provenance: { kind: "email", senderEmail: NAMED_SENDER } },
	{ url: FROM_A_STRANGER, provenance: { kind: "email", senderEmail: "stranger@example.com" } },
	{ url: FROM_THE_WEB, provenance: { kind: "web" } },
];

const Link = z.object({ rel: z.array(z.string()), href: z.string(), title: z.string().optional(), type: z.string().optional() });
const Article = z.looseObject({
	properties: z.looseObject({
		id: z.string(),
		url: z.string(),
		via: z.object({ label: z.string(), sender: z.object({ name: z.string(), address: z.string() }).optional() }).optional(),
	}),
	links: z.array(Link),
});
const Collection = z.looseObject({ entities: z.array(Article) });

async function readerWithEmailedSaves() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const catalog = initInMemoryNewsletterCatalog({ version: 1, records: [TLDR] });
	let catalogReads = 0;
	const harness = useApp({
		...fixture,
		newsletterCatalog: {
			...fixture.newsletterCatalog,
			readNewsletterCatalog: async () => {
				catalogReads += 1;
				return catalog.readCatalog();
			},
		},
	});
	const ids = new Map<string, string>();
	for (const save of SAVES) {
		const { saved } = await harness.articleStore.saveArticle({
			userId: USER_ID,
			url: save.url,
			metadata: { title: `Saved ${save.url}`, siteName: "example.com", excerpt: "", wordCount: 0 },
			estimatedReadTime: MinutesSchema.parse(0),
			provenance: save.provenance,
			savedAt: new Date(),
			saveTrigger: "manual",
		});
		ids.set(save.url, saved.id.value);
	}
	const token = await createAccessToken(harness);
	const get = (path: string) =>
		request(harness.server).get(path).set("Authorization", `Bearer ${token}`).set("Accept", SIREN_MEDIA_TYPE);
	return {
		get,
		catalogReads: () => catalogReads,
		idOf: (url: string): string => {
			const id = ids.get(url);
			assert(id, `the save of ${url} must have an id`);
			return id;
		},
	};
}

const viaByUrl = (entities: z.infer<typeof Article>[]) =>
	Object.fromEntries(entities.map((entity) => [entity.properties.url, entity.properties.via]));

const EXPECTED_VIA = {
	[FROM_TLDR]: { label: "via TLDR", sender: { name: "TLDR", address: NAMED_SENDER } },
	[FROM_A_STRANGER]: { label: "via stranger@example.com" },
	[FROM_THE_WEB]: undefined,
};

describe("article card display over Siren", () => {
	it("names each emailed save's sender on the collection as the web card does, resolving the page's senders in one batch", async () => {
		const { get, catalogReads } = await readerWithEmailedSaves();

		const response = await get("/queue");

		expect(response.status).toBe(200);
		expect(viaByUrl(Collection.parse(response.body).entities)).toEqual(EXPECTED_VIA);
		expect(catalogReads()).toBe(1);
	});

	it("keeps the same sender facts on an individually refreshed card, so a poll never drops what the row showed", async () => {
		const { get, idOf } = await readerWithEmailedSaves();

		const cards = await Promise.all(SAVES.map((save) => get(`/queue/${idOf(save.url)}/card`)));

		expect(cards.map((card) => card.status)).toEqual([200, 200, 200]);
		expect(viaByUrl(cards.map((card) => Article.parse(card.body)))).toEqual(EXPECTED_VIA);
	});

	it("links each public save to its original page beside the reader link it keeps", async () => {
		const { get } = await readerWithEmailedSaves();

		const response = await get("/queue");

		const links = Collection.parse(response.body).entities.map((entity) =>
			entity.links.filter((link) => link.rel.includes("original") || link.rel.includes("read")).map((link) => link.rel[0]),
		);
		expect(links).toEqual([
			["read", "original"],
			["read", "original"],
			["read", "original"],
		]);
	});
});
