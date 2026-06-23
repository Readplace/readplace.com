import assert from "node:assert/strict";
import { resolveWriteAccess } from "./resolve-write-access";

const NOW = new Date("2026-05-23T12:00:00.000Z");
const ONE_DAY_MS = 86_400_000;

describe("resolveWriteAccess", () => {
	it("grants full access to a founding member with no subscription row", () => {
		assert.equal(resolveWriteAccess(undefined, NOW), "full");
	});

	it("grants full access to an active subscription", () => {
		assert.equal(resolveWriteAccess({ status: "active" }, NOW), "full");
	});

	it("keeps full access for a pending cancellation still inside its prepaid window", () => {
		const cancellationEffectiveAt = new Date(NOW.getTime() + 5 * ONE_DAY_MS).toISOString();
		assert.equal(
			resolveWriteAccess({ status: "pending_cancellation", cancellationEffectiveAt }, NOW),
			"full",
		);
	});

	it("drops to read-only once the pending-cancellation window has elapsed", () => {
		const cancellationEffectiveAt = new Date(NOW.getTime() - ONE_DAY_MS).toISOString();
		assert.equal(
			resolveWriteAccess({ status: "pending_cancellation", cancellationEffectiveAt }, NOW),
			"read-only",
		);
	});

	it("treats a cancellation-effective-at instant equal to now as elapsed", () => {
		assert.equal(
			resolveWriteAccess(
				{ status: "pending_cancellation", cancellationEffectiveAt: NOW.toISOString() },
				NOW,
			),
			"read-only",
		);
	});

	it("keeps full access while a trial is still running", () => {
		const trialEndsAt = new Date(NOW.getTime() + 7 * ONE_DAY_MS).toISOString();
		assert.equal(resolveWriteAccess({ status: "trialing", trialEndsAt }, NOW), "full");
	});

	it("drops to read-only once the trial has elapsed", () => {
		const trialEndsAt = new Date(NOW.getTime() - ONE_DAY_MS).toISOString();
		assert.equal(resolveWriteAccess({ status: "trialing", trialEndsAt }, NOW), "read-only");
	});

	it("treats a trial-ends-at instant equal to now as elapsed", () => {
		assert.equal(
			resolveWriteAccess({ status: "trialing", trialEndsAt: NOW.toISOString() }, NOW),
			"read-only",
		);
	});

	it("treats a cancelled subscription as read-only", () => {
		assert.equal(resolveWriteAccess({ status: "cancelled" }, NOW), "read-only");
	});
});
