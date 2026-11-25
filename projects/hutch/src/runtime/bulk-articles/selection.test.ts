import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { BULK_CHUNK_SIZE, newSelection, type SelectionSpec } from "./selection";
import { initInMemoryBulkSelections } from "./selection-store";

describe("account-owned bulk article selections", () => {
	const user = UserIdSchema.parse("reader");
	const now = new Date("2026-11-24T00:00:00.000Z");
	const spec: SelectionSpec = { source: "all", status: "unread", page: 1, order: "desc", extent: "all", action: { kind: "remove" } };

	it("materializes 20,000 stable versions in bounded chunks, ignoring duplicate occurrences, and confirms once", async () => {
		const store = initInMemoryBulkSelections();
		let job = newSelection(user, spec, now);
		await store.create(job);
		const first = job;
		for (let start = 0; start < 20_000; start += BULK_CHUNK_SIZE) {
			const end = Math.min(start + BULK_CHUNK_SIZE, 20_000);
			const rows = Array.from({ length: end - start }, (_, index) => ({
				key: `example.org/${start + index}`, url: `https://example.org/${start + index}`, version: String(start),
			}));
			expect(await store.append(job, rows, String(end), now)).toBe(true);
			const next = await store.get(user, job.id);
			assert(next);
			job = next;
		}
		expect(await store.append(first, [], undefined, now)).toBe(false);
		expect(await store.get(UserIdSchema.parse("another-reader"), job.id)).toBeUndefined();
		expect(await store.append(job, [{ key: "example.org/0", url: "https://example.org/0", version: "later" }], undefined, now)).toBe(true);
		const preview = await store.get(user, job.id);
		assert(preview);
		expect(preview).toMatchObject({ selected: 20_000, state: "preview" });
		const results = await Promise.all([store.confirm(preview, now), store.confirm(preview, now)]);
		expect(results.sort()).toEqual([false, true]);
	});
	it("refuses expired and unfinished selections", async () => {
		const store = initInMemoryBulkSelections();
		const job = newSelection(user, spec, now);
		await store.create(job);
		expect(await store.confirm(job, now)).toBe(false);
		expect(await store.append(job, [], undefined, new Date(now.getTime() + 3_600_000))).toBe(false);
	});
});
