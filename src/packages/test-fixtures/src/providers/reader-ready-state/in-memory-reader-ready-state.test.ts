import type { UserId } from "@packages/domain/user";
import { initInMemoryReaderReadyState } from "./in-memory-reader-ready-state";

const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const USER = "user-1" as UserId;

describe("initInMemoryReaderReadyState", () => {
	describe("claimReaderReadyEmailSlot", () => {
		it("claims the slot when no reader-ready email has ever been sent", async () => {
			const store = initInMemoryReaderReadyState();

			const claimed = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(claimed).toBe(true);
		});

		it("rejects a second claim inside the cooldown window", async () => {
			const store = initInMemoryReaderReadyState();
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			const second = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T12:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(second).toBe(false);
		});

		it("claims again once the cooldown window has elapsed", async () => {
			const store = initInMemoryReaderReadyState();
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			const later = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T17:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(later).toBe(true);
		});

		it("tracks the cooldown per user independently", async () => {
			const store = initInMemoryReaderReadyState();
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			const otherUser = await store.claimReaderReadyEmailSlot({
				userId: "user-2" as UserId,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(otherUser).toBe(true);
		});
	});

	describe("releaseReaderReadyEmailSlot", () => {
		it("frees a claimed slot so the same user can claim again immediately", async () => {
			const store = initInMemoryReaderReadyState();
			const claimedAt = new Date("2026-05-30T10:00:00.000Z");
			await store.claimReaderReadyEmailSlot({ userId: USER, now: claimedAt, cooldownMs: COOLDOWN_MS });

			await store.releaseReaderReadyEmailSlot({ userId: USER, claimedAt });

			const reclaimed = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:01:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});
			expect(reclaimed).toBe(true);
		});

		it("leaves a newer claim intact when the release timestamp no longer matches", async () => {
			const store = initInMemoryReaderReadyState();
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			await store.releaseReaderReadyEmailSlot({
				userId: USER,
				claimedAt: new Date("2026-05-30T09:00:00.000Z"),
			});

			const second = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T11:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});
			expect(second).toBe(false);
		});
	});

	describe("deleteReaderReadyState", () => {
		it("clears the cooldown row so the user can immediately claim again", async () => {
			const store = initInMemoryReaderReadyState();
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			await store.deleteReaderReadyState(USER);

			const reclaimed = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:01:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});
			expect(reclaimed).toBe(true);
		});

		it("is a no-op when the user has no cooldown row", async () => {
			const store = initInMemoryReaderReadyState();

			await expect(store.deleteReaderReadyState(USER)).resolves.toBeUndefined();
		});
	});
});
