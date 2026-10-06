import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { type NewsletterCatalogDocument, NewsletterNameSchema, initCatalogNewsletterDetector } from "@packages/domain/newsletter-catalog";
import { initResolveReaderProvenance } from "./resolve-reader-provenance";

const AT = "2026-09-30T00:00:00.000Z";
const CATALOG: NewsletterCatalogDocument = {
	version: 1,
	records: [
		{ from: ForwardableSenderSchema.parse("dan@tldr.tech"), name: NewsletterNameSchema.parse("TLDR"), status: "approved", evidence: [], createdAt: AT, updatedAt: AT },
		{ from: ForwardableSenderSchema.parse("unnamed@publisher.example"), status: "approved", evidence: [], createdAt: AT, updatedAt: AT },
	],
};

function resolverOver(catalog: { ok: true; document: NewsletterCatalogDocument } | { ok: false; reason: "unavailable" }) {
	return initResolveReaderProvenance({
		detectNewsletters: initCatalogNewsletterDetector({ readCatalog: async () => catalog }),
	});
}

describe("initResolveReaderProvenance", () => {
	const resolve = resolverOver({ ok: true, document: CATALOG });

	it("names the newsletter the catalog records for the sender, however the address was cased", async () => {
		assert.deepEqual(await resolve({ kind: "email", senderEmail: " Dan@TLDR.tech " }), { kind: "newsletter", name: "TLDR" });
	});

	it("keeps the sender address when the catalog does not name the sender", async () => {
		assert.deepEqual(
			await Promise.all([
				resolve({ kind: "email", senderEmail: "unnamed@publisher.example" }),
				resolve({ kind: "email", senderEmail: "stranger@example.com" }),
				resolve({ kind: "email", senderEmail: "" }),
			]),
			[
				{ kind: "email", senderEmail: "unnamed@publisher.example" },
				{ kind: "email", senderEmail: "stranger@example.com" },
				{ kind: "email", senderEmail: "" },
			],
		);
	});

	it("keeps the sender address when the catalog cannot be read", async () => {
		const unavailable = resolverOver({ ok: false, reason: "unavailable" });

		assert.deepEqual(await unavailable({ kind: "email", senderEmail: "dan@tldr.tech" }), { kind: "email", senderEmail: "dan@tldr.tech" });
	});

	it("leaves a save that did not arrive by email as it was stored", async () => {
		assert.deepEqual(await Promise.all([resolve({ kind: "web" }), resolve(undefined)]), [{ kind: "web" }, undefined]);
	});
});
