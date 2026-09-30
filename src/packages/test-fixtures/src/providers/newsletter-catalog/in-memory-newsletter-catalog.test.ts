import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import type { NewsletterCatalogDocument } from "@packages/domain/newsletter-catalog";
import { initInMemoryNewsletterCatalog } from "./in-memory-newsletter-catalog";

const AT = "2026-09-30T00:00:00.000Z";
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const PENDING_TLDR: NewsletterCatalogDocument = {
	version: 1,
	records: [{ from: TLDR, status: "pending", evidence: [], createdAt: AT, updatedAt: AT }],
};

describe("initInMemoryNewsletterCatalog", () => {
	it("reads an empty catalog with no version tag before anything was written", async () => {
		const catalog = initInMemoryNewsletterCatalog(undefined);

		assert.deepEqual(await catalog.readCatalog(), { ok: true, document: { version: 1, records: [] }, etag: undefined });
		assert.equal(catalog.current(), undefined);
	});

	it("creates the document only when the writer expects it to be absent", async () => {
		const catalog = initInMemoryNewsletterCatalog(undefined);

		assert.deepEqual(await catalog.writeCatalog({ document: PENDING_TLDR, expectedEtag: "etag-9" }), { ok: false, reason: "conflict" });
		assert.deepEqual(await catalog.writeCatalog({ document: PENDING_TLDR, expectedEtag: undefined }), { ok: true, etag: "etag-2" });
		assert.deepEqual(await catalog.readCatalog(), { ok: true, document: PENDING_TLDR, etag: "etag-2" });
	});

	it("stores a written document as its JSON would read back, dropping unset fields", async () => {
		const catalog = initInMemoryNewsletterCatalog(undefined);
		const withUnsetFields: NewsletterCatalogDocument = {
			version: 1,
			records: [{ from: TLDR, name: undefined, status: "pending", evidence: [], replacedBy: undefined, createdAt: AT, updatedAt: AT }],
		};

		await catalog.writeCatalog({ document: withUnsetFields, expectedEtag: undefined });

		assert.deepEqual(catalog.current(), PENDING_TLDR);
	});

	it("refuses a write based on an outdated version tag", async () => {
		const catalog = initInMemoryNewsletterCatalog(PENDING_TLDR);
		const read = await catalog.readCatalog();
		assert(read.ok);
		assert.equal(read.etag, "etag-1");
		await catalog.writeCatalog({ document: PENDING_TLDR, expectedEtag: read.etag });

		assert.deepEqual(await catalog.writeCatalog({ document: { version: 1, records: [] }, expectedEtag: read.etag }), {
			ok: false,
			reason: "conflict",
		});
		assert.deepEqual(catalog.current(), PENDING_TLDR);
	});

	it("simulates a concurrent writer winning the next write once", async () => {
		const catalog = initInMemoryNewsletterCatalog(PENDING_TLDR);
		catalog.conflictNextWrite();

		assert.deepEqual(await catalog.writeCatalog({ document: PENDING_TLDR, expectedEtag: "etag-1" }), { ok: false, reason: "conflict" });
		assert.deepEqual(await catalog.writeCatalog({ document: PENDING_TLDR, expectedEtag: "etag-1" }), { ok: true, etag: "etag-2" });
	});

	it("simulates storage failing the next write once", async () => {
		const catalog = initInMemoryNewsletterCatalog(PENDING_TLDR);
		catalog.failNextWrite();

		assert.deepEqual(await catalog.writeCatalog({ document: PENDING_TLDR, expectedEtag: "etag-1" }), { ok: false, reason: "unavailable" });
		assert.deepEqual(await catalog.writeCatalog({ document: PENDING_TLDR, expectedEtag: "etag-1" }), { ok: true, etag: "etag-2" });
	});

	it("reports reads as unavailable while storage is failing and recovers afterwards", async () => {
		const catalog = initInMemoryNewsletterCatalog(PENDING_TLDR);

		catalog.failReads(true);
		assert.deepEqual(await catalog.readCatalog(), { ok: false, reason: "unavailable" });

		catalog.failReads(false);
		assert.deepEqual(await catalog.readCatalog(), { ok: true, document: PENDING_TLDR, etag: "etag-1" });
	});
});
