import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { type NewsletterCatalogDocument, mergeSubmittedSender } from "@packages/domain/newsletter-catalog";
import type { WriteNewsletterCatalog } from "@packages/provider-contracts/newsletter-catalog";
import { initInMemoryNewsletterCatalog } from "@packages/test-fixtures/providers/newsletter-catalog";
import { initUpdateNewsletterCatalog } from "./update-newsletter-catalog";

const NOW = new Date("2026-09-30T00:00:00.000Z");
const TLDR = ForwardableSenderSchema.parse("dan@tldrnewsletter.com");
const MORNING = ForwardableSenderSchema.parse("crew@morningbrew.com");

const submit = (from: typeof TLDR) => (document: NewsletterCatalogDocument) => mergeSubmittedSender(document, { from, now: NOW });

describe("initUpdateNewsletterCatalog", () => {
	it("writes the changed document against the version it read", async () => {
		const catalog = initInMemoryNewsletterCatalog(undefined);
		const update = initUpdateNewsletterCatalog({
			readCatalog: catalog.readCatalog,
			writeCatalog: catalog.writeCatalog,
			maxAttempts: 3,
		});

		const result = await update(submit(TLDR));

		assert.equal(result.ok, true);
		assert.deepEqual(
			catalog.current()?.records.map((record) => [record.from, record.status]),
			[[TLDR, "pending"]],
		);
	});

	it("re-reads and re-applies the change when another writer got there first", async () => {
		const catalog = initInMemoryNewsletterCatalog(undefined);
		const expectedEtags: (string | undefined)[] = [];
		let raced = false;
		const racingWrite: WriteNewsletterCatalog = async (input) => {
			expectedEtags.push(input.expectedEtag);
			if (!raced) {
				raced = true;
				const competing = submit(MORNING)({ version: 1, records: [] });
				assert(competing.ok);
				await catalog.writeCatalog({
					document: competing.document,
					expectedEtag: undefined,
				});
			}
			return catalog.writeCatalog(input);
		};
		const update = initUpdateNewsletterCatalog({
			readCatalog: catalog.readCatalog,
			writeCatalog: racingWrite,
			maxAttempts: 3,
		});

		const result = await update(submit(TLDR));

		assert.equal(result.ok, true);
		assert.deepEqual(expectedEtags, [undefined, "etag-2"]);
		assert.deepEqual(
			catalog.current()?.records.map((record) => [record.from, record.status]),
			[
				[MORNING, "pending"],
				[TLDR, "pending"],
			],
		);
	});

	it("gives up as a conflict once every attempt lost the race", async () => {
		const catalog = initInMemoryNewsletterCatalog(undefined);
		const attempts: (string | undefined)[] = [];
		const alwaysConflicting: WriteNewsletterCatalog = async (input) => {
			attempts.push(input.expectedEtag);
			return { ok: false, reason: "conflict" };
		};
		const update = initUpdateNewsletterCatalog({
			readCatalog: catalog.readCatalog,
			writeCatalog: alwaysConflicting,
			maxAttempts: 3,
		});

		const result = await update(submit(TLDR));

		assert.deepEqual(result, { ok: false, reason: "conflict" });
		assert.deepEqual(attempts, [undefined, undefined, undefined]);
	});

	it("returns the moderation refusal without writing", async () => {
		const catalog = initInMemoryNewsletterCatalog(undefined);
		const update = initUpdateNewsletterCatalog({
			readCatalog: catalog.readCatalog,
			writeCatalog: catalog.writeCatalog,
			maxAttempts: 3,
		});
		await update(submit(TLDR));
		catalog.failNextWrite();

		const result = await update(submit(TLDR));

		assert.deepEqual(result, { ok: false, reason: "unchanged" });
		assert.equal((await update(submit(MORNING))).ok, false);
	});

	it("reports an unreadable catalog as unavailable", async () => {
		const catalog = initInMemoryNewsletterCatalog(undefined);
		catalog.failReads(true);
		const update = initUpdateNewsletterCatalog({
			readCatalog: catalog.readCatalog,
			writeCatalog: catalog.writeCatalog,
			maxAttempts: 3,
		});

		assert.deepEqual(await update(submit(TLDR)), {
			ok: false,
			reason: "unavailable",
		});
	});

	it("reports a failed write as unavailable without retrying", async () => {
		const catalog = initInMemoryNewsletterCatalog(undefined);
		catalog.failNextWrite();
		const update = initUpdateNewsletterCatalog({
			readCatalog: catalog.readCatalog,
			writeCatalog: catalog.writeCatalog,
			maxAttempts: 3,
		});

		assert.deepEqual(await update(submit(TLDR)), {
			ok: false,
			reason: "unavailable",
		});
		assert.equal(catalog.current(), undefined);
	});
});
