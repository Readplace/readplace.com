import assert from "node:assert/strict";
import {
	IMPORT_SESSION_TTL_SECONDS,
	ImportSessionIdSchema,
} from "@packages/domain/import-session";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryImportSession } from "./in-memory-import-session";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");

describe("initInMemoryImportSession", () => {
	it("creates a session with default-checked URLs", async () => {
		const store = initInMemoryImportSession({ now: () => new Date("2026-05-01T00:00:00Z") });

		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a", "https://example.com/b"],
			truncated: false,
			totalFound: 2,
		});

		expect(session.totalUrls).toBe(2);
		expect(session.deselected.size).toBe(0);
		expect(session.truncated).toBe(false);
	});

	it("returns undefined to a different user (cross-user isolation)", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a"],
			truncated: false,
			totalFound: 1,
		});

		const peek = await store.findImportSession({ id: session.id, userId: otherUser });

		expect(peek).toBeUndefined();
	});

	it("returns undefined for a non-existent id", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const ghost = ImportSessionIdSchema.parse("00000000000000000000000000000000");

		expect(await store.findImportSession({ id: ghost, userId: owner })).toBeUndefined();
	});

	it("expires sessions whose TTL has elapsed", async () => {
		let now = new Date("2026-05-01T00:00:00Z");
		const store = initInMemoryImportSession({ now: () => now });
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a"],
			truncated: false,
			totalFound: 1,
		});

		// Advance past TTL
		now = new Date(now.getTime() + (IMPORT_SESSION_TTL_SECONDS + 1) * 1000);

		expect(await store.findImportSession({ id: session.id, userId: owner })).toBeUndefined();
	});

	it("toggles a row deselected then re-selected", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a", "https://example.com/b"],
			truncated: false,
			totalFound: 2,
		});

		await store.toggleImportSelection({ id: session.id, userId: owner, index: 0, checked: false });
		const after = await store.findImportSession({ id: session.id, userId: owner });
		assert(after, "session must exist after toggle");
		expect([...after.deselected]).toEqual([0]);

		await store.toggleImportSelection({ id: session.id, userId: owner, index: 0, checked: true });
		const reset = await store.findImportSession({ id: session.id, userId: owner });
		assert(reset, "session must exist after second toggle");
		expect(reset.deselected.size).toBe(0);
	});

	it("deselects every row via toggleAllImportSelection({ checked: false })", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
			truncated: false,
			totalFound: 3,
		});

		await store.toggleAllImportSelection({ id: session.id, userId: owner, checked: false });

		const after = await store.findImportSession({ id: session.id, userId: owner });
		assert(after, "session must exist after bulk toggle");
		expect([...after.deselected].sort()).toEqual([0, 1, 2]);
	});

	it("re-selects every row via toggleAllImportSelection({ checked: true })", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a", "https://example.com/b"],
			truncated: false,
			totalFound: 2,
		});
		await store.toggleImportSelection({ id: session.id, userId: owner, index: 0, checked: false });
		await store.toggleImportSelection({ id: session.id, userId: owner, index: 1, checked: false });

		await store.toggleAllImportSelection({ id: session.id, userId: owner, checked: true });

		const after = await store.findImportSession({ id: session.id, userId: owner });
		assert(after, "session must exist after bulk toggle");
		expect(after.deselected.size).toBe(0);
	});

	it("re-selects one row after bulk deselect", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a", "https://example.com/b", "https://example.com/c"],
			truncated: false,
			totalFound: 3,
		});

		await store.toggleAllImportSelection({ id: session.id, userId: owner, checked: false });
		await store.toggleImportSelection({ id: session.id, userId: owner, index: 1, checked: true });

		const after = await store.findImportSession({ id: session.id, userId: owner });
		assert(after, "session must exist");
		expect([...after.deselected].sort()).toEqual([0, 2]);
	});

	it("ignores bulk toggles from a non-owner", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a", "https://example.com/b"],
			truncated: false,
			totalFound: 2,
		});

		await store.toggleAllImportSelection({ id: session.id, userId: otherUser, checked: false });

		const after = await store.findImportSession({ id: session.id, userId: owner });
		assert(after, "session must still exist");
		expect(after.deselected.size).toBe(0);
	});

	it("ignores toggles from a non-owner", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a"],
			truncated: false,
			totalFound: 1,
		});

		await store.toggleImportSelection({ id: session.id, userId: otherUser, index: 0, checked: false });
		const after = await store.findImportSession({ id: session.id, userId: owner });
		assert(after, "session must still exist");
		expect(after.deselected.size).toBe(0);
	});

	it("returns the page slice for the requested page", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const urls = Array.from({ length: 12 }, (_v, i) => `https://example.com/post-${i}`);
		const session = await store.createImportSession({ userId: owner, urls, truncated: true, totalFound: 15 });

		const page2 = await store.loadImportSessionPage({ id: session.id, userId: owner, page: 2, pageSize: 5 });
		assert(page2, "page 2 must exist");
		expect(page2.pageUrls).toEqual(urls.slice(5, 10));
		expect(page2.session.truncated).toBe(true);
	});

	it("returns undefined from page/all readers when the session is missing or stolen", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const ghost = ImportSessionIdSchema.parse("11111111111111111111111111111111");
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a"],
			truncated: false,
			totalFound: 1,
		});

		expect(
			await store.loadImportSessionPage({ id: ghost, userId: owner, page: 1, pageSize: 50 }),
		).toBeUndefined();
		expect(await store.loadAllImportSessionUrls({ id: ghost, userId: owner })).toBeUndefined();
		expect(
			await store.loadAllImportSessionUrls({ id: session.id, userId: otherUser }),
		).toBeUndefined();
	});

	it("deletes a session and refuses subsequent reads", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a"],
			truncated: false,
			totalFound: 1,
		});

		await store.deleteImportSession({ id: session.id, userId: owner });

		expect(await store.findImportSession({ id: session.id, userId: owner })).toBeUndefined();
	});

	it("ignores delete attempts from a non-owner", async () => {
		const store = initInMemoryImportSession({ now: () => new Date() });
		const session = await store.createImportSession({
			userId: owner,
			urls: ["https://example.com/a"],
			truncated: false,
			totalFound: 1,
		});

		await store.deleteImportSession({ id: session.id, userId: otherUser });

		const stillThere = await store.findImportSession({ id: session.id, userId: owner });
		expect(stillThere).toBeDefined();
	});
});
