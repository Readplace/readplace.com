import assert from "node:assert/strict";
import { type ForwardableSender, ForwardableSenderSchema } from "@packages/domain/gmail";
import {
	type DetectNewsletters,
	type NewsletterCatalogDocument,
	NewsletterNameSchema,
	initCatalogNewsletterDetector,
} from "@packages/domain/newsletter-catalog";
import { initResolveReaderProvenance, initResolveReaderProvenances } from "./resolve-reader-provenance";

const AT = "2026-09-30T00:00:00.000Z";
const CATALOG: NewsletterCatalogDocument = {
	version: 1,
	records: [
		{ from: ForwardableSenderSchema.parse("dan@tldr.tech"), name: NewsletterNameSchema.parse("TLDR"), status: "approved", evidence: [], createdAt: AT, updatedAt: AT },
		{ from: ForwardableSenderSchema.parse("unnamed@publisher.example"), status: "approved", evidence: [], createdAt: AT, updatedAt: AT },
	],
};

function detectorOver(catalog: { ok: true; document: NewsletterCatalogDocument } | { ok: false; reason: "unavailable" }): DetectNewsletters {
	return initCatalogNewsletterDetector({ readCatalog: async () => catalog });
}

function resolverOver(catalog: { ok: true; document: NewsletterCatalogDocument } | { ok: false; reason: "unavailable" }) {
	return initResolveReaderProvenance({ detectNewsletters: detectorOver(catalog) });
}

function countingDetector(detect: DetectNewsletters): { detect: DetectNewsletters; asked: ForwardableSender[][] } {
	const asked: ForwardableSender[][] = [];
	return {
		asked,
		detect: (senders) => {
			asked.push([...senders]);
			return detect(senders);
		},
	};
}

describe("initResolveReaderProvenance", () => {
	const resolve = resolverOver({ ok: true, document: CATALOG });

	it("names the newsletter the catalog records for the sender, however the address was cased, keeping the address behind the name", async () => {
		assert.deepEqual(await resolve({ kind: "email", senderEmail: " Dan@TLDR.tech " }), {
			kind: "newsletter",
			name: "TLDR",
			senderEmail: "dan@tldr.tech",
		});
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

describe("initResolveReaderProvenances", () => {
	it("asks the catalog once for a page's distinct forwardable senders and names each row from that one answer", async () => {
		const catalog = countingDetector(detectorOver({ ok: true, document: CATALOG }));
		const resolve = initResolveReaderProvenances({ detectNewsletters: catalog.detect });

		const resolved = await resolve([
			{ kind: "email", senderEmail: "dan@tldr.tech" },
			{ kind: "web" },
			{ kind: "email", senderEmail: " Dan@TLDR.tech " },
			{ kind: "email", senderEmail: "stranger@example.com" },
			undefined,
			{ kind: "email", senderEmail: "" },
		]);

		assert.deepEqual(catalog.asked, [["dan@tldr.tech", "stranger@example.com"]]);
		assert.deepEqual(resolved, [
			{ kind: "newsletter", name: "TLDR", senderEmail: "dan@tldr.tech" },
			{ kind: "web" },
			{ kind: "newsletter", name: "TLDR", senderEmail: "dan@tldr.tech" },
			{ kind: "email", senderEmail: "stranger@example.com" },
			undefined,
			{ kind: "email", senderEmail: "" },
		]);
	});

	it("leaves the catalog alone for a page without an emailed save", async () => {
		const catalog = countingDetector(detectorOver({ ok: true, document: CATALOG }));
		const resolve = initResolveReaderProvenances({ detectNewsletters: catalog.detect });

		const resolved = await resolve([{ kind: "web" }, undefined, { kind: "client", clientName: "chrome" }]);

		assert.deepEqual(catalog.asked, []);
		assert.deepEqual(resolved, [{ kind: "web" }, undefined, { kind: "client", clientName: "chrome" }]);
	});

	it("keeps every sender address when the catalog cannot be read", async () => {
		const resolve = initResolveReaderProvenances({ detectNewsletters: detectorOver({ ok: false, reason: "unavailable" }) });

		assert.deepEqual(await resolve([{ kind: "email", senderEmail: "dan@tldr.tech" }, { kind: "web" }]), [
			{ kind: "email", senderEmail: "dan@tldr.tech" },
			{ kind: "web" },
		]);
	});
});
