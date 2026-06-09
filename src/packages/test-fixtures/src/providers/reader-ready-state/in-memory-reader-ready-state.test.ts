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
});
