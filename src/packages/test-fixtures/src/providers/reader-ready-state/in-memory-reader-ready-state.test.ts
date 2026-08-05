import type { UserId } from "@packages/domain/user";
import { initInMemoryReaderReadyState } from "./in-memory-reader-ready-state";

const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const USER = "user-1" as UserId;
const MESSAGE = "msg-1";

describe("initInMemoryReaderReadyState", () => {
	describe("claimReaderReadyEmailSlot", () => {
		it("claims the slot when no reader-ready email has ever been sent", async () => {
			const store = initInMemoryReaderReadyState();

			const claim = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			expect(claim).toEqual({ claimed: true, redelivery: false });
		});

		it("rejects a different message's claim inside the cooldown window", async () => {
			const store = initInMemoryReaderReadyState();
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			const second = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T12:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: "msg-2",
			});

			expect(second).toEqual({ claimed: false });
		});

		it("reports a redelivery, with the original claim instant, when the same message claims twice", async () => {
			const store = initInMemoryReaderReadyState();
			const first = new Date("2026-05-30T10:00:00.000Z");
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: first,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			const again = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:02:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			expect(again).toEqual({ claimed: true, redelivery: true, claimedAt: first });
		});

		it("keeps reporting the original instant however many times the message is redelivered", async () => {
			const store = initInMemoryReaderReadyState();
			const first = new Date("2026-05-30T10:00:00.000Z");
			const params = { userId: USER, cooldownMs: COOLDOWN_MS, messageId: MESSAGE };
			await store.claimReaderReadyEmailSlot({ ...params, now: first });
			await store.claimReaderReadyEmailSlot({ ...params, now: new Date("2026-05-30T10:02:00.000Z") });

			const third = await store.claimReaderReadyEmailSlot({
				...params,
				now: new Date("2026-05-30T10:04:00.000Z"),
			});

			expect(third).toEqual({ claimed: true, redelivery: true, claimedAt: first });
		});

		it("treats a receive after the cooldown lapsed as a fresh claim, so a stale redrive re-sends rather than draining", async () => {
			const store = initInMemoryReaderReadyState();
			const params = { userId: USER, cooldownMs: COOLDOWN_MS, messageId: MESSAGE };
			await store.claimReaderReadyEmailSlot({ ...params, now: new Date("2026-05-30T10:00:00.000Z") });

			const muchLater = await store.claimReaderReadyEmailSlot({
				...params,
				now: new Date("2026-05-31T10:00:00.000Z"),
			});

			expect(muchLater).toEqual({ claimed: true, redelivery: false });
		});

		it("claims again once the cooldown window has elapsed", async () => {
			const store = initInMemoryReaderReadyState();
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			const later = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T17:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: "msg-2",
			});

			expect(later).toEqual({ claimed: true, redelivery: false });
		});

		it("tracks the cooldown per user independently", async () => {
			const store = initInMemoryReaderReadyState();
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			const otherUser = await store.claimReaderReadyEmailSlot({
				userId: "user-2" as UserId,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: "msg-2",
			});

			expect(otherUser).toEqual({ claimed: true, redelivery: false });
		});
	});

	describe("releaseReaderReadyEmailSlot", () => {
		it("frees a claimed slot so the same user can claim again immediately", async () => {
			const store = initInMemoryReaderReadyState();
			const claimedAt = new Date("2026-05-30T10:00:00.000Z");
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: claimedAt,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			await store.releaseReaderReadyEmailSlot({ userId: USER, claimedAt, messageId: MESSAGE });

			const reclaimed = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:01:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: "msg-2",
			});
			expect(reclaimed).toEqual({ claimed: true, redelivery: false });
		});

		it("forgets the message id too, so the released message re-sends instead of taking the redelivery path", async () => {
			const store = initInMemoryReaderReadyState();
			const claimedAt = new Date("2026-05-30T10:00:00.000Z");
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: claimedAt,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			await store.releaseReaderReadyEmailSlot({ userId: USER, claimedAt, messageId: MESSAGE });

			const redriven = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:01:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});
			expect(redriven).toEqual({ claimed: true, redelivery: false });
		});

		it("leaves a newer claim intact when the release timestamp no longer matches", async () => {
			const store = initInMemoryReaderReadyState();
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			await store.releaseReaderReadyEmailSlot({
				userId: USER,
				claimedAt: new Date("2026-05-30T09:00:00.000Z"),
				messageId: MESSAGE,
			});

			const second = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T11:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: "msg-2",
			});
			expect(second).toEqual({ claimed: false });
		});

		it("leaves another message's claim intact", async () => {
			const store = initInMemoryReaderReadyState();
			const claimedAt = new Date("2026-05-30T10:00:00.000Z");
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: claimedAt,
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			await store.releaseReaderReadyEmailSlot({ userId: USER, claimedAt, messageId: "msg-2" });

			const second = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T11:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: "msg-3",
			});
			expect(second).toEqual({ claimed: false });
		});
	});

	describe("deleteReaderReadyState", () => {
		it("clears the cooldown row so the user can immediately claim again", async () => {
			const store = initInMemoryReaderReadyState();
			await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: MESSAGE,
			});

			await store.deleteReaderReadyState(USER);

			const reclaimed = await store.claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:01:00.000Z"),
				cooldownMs: COOLDOWN_MS,
				messageId: "msg-2",
			});
			expect(reclaimed).toEqual({ claimed: true, redelivery: false });
		});

		it("is a no-op when the user has no cooldown row", async () => {
			const store = initInMemoryReaderReadyState();

			await expect(store.deleteReaderReadyState(USER)).resolves.toBeUndefined();
		});
	});
});
