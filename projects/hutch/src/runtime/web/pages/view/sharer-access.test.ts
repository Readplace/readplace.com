import assert from "node:assert/strict";
import { UserIdSchema, userIdPrefixFrom } from "@packages/domain/user";
import type { UserId } from "@packages/domain/user";
import type { EffectiveAccess } from "@packages/subscription-access";
import { resolveSharerPublicAccess } from "./sharer-access";

const SHARER = UserIdSchema.parse("abc123deadbeef1234567890abcdef01");
const OTHER = UserIdSchema.parse("abc123ffffffffffffffffffffffff02");
const PREFIX = userIdPrefixFrom(SHARER);

const FOUNDING: EffectiveAccess = { tier: "founding", access: "full", banner: "none" };
const PAID: EffectiveAccess = { tier: "paid", access: "full", banner: "none" };
const TRIAL_EXPIRED: EffectiveAccess = {
	tier: "inactive",
	access: "read-only",
	banner: "inactive",
	reason: "trial-expired",
};
const CANCELLED: EffectiveAccess = {
	tier: "inactive",
	access: "read-only",
	banner: "inactive",
	reason: "subscription-cancelled",
};

function deps(userIds: UserId[], access: Record<string, EffectiveAccess>) {
	return {
		findUserIdsByPrefix: async () => userIds,
		getEffectiveAccess: async (userId: UserId) => {
			const found = access[userId];
			assert(found, `no access stubbed for ${userId}`);
			return found;
		},
	};
}

describe("resolveSharerPublicAccess", () => {
	it("reports unknown when the prefix matches no user", async () => {
		const result = await resolveSharerPublicAccess(deps([], {}), PREFIX);
		assert.equal(result, "unknown");
	});

	it("reports valid for a paying sharer", async () => {
		const result = await resolveSharerPublicAccess(
			deps([SHARER], { [SHARER]: PAID }),
			PREFIX,
		);
		assert.equal(result, "valid");
	});

	it("reports valid for a founding member, who has no subscription row", async () => {
		const result = await resolveSharerPublicAccess(
			deps([SHARER], { [SHARER]: FOUNDING }),
			PREFIX,
		);
		assert.equal(result, "valid");
	});

	it("reports inactive when the sharer's trial has expired", async () => {
		const result = await resolveSharerPublicAccess(
			deps([SHARER], { [SHARER]: TRIAL_EXPIRED }),
			PREFIX,
		);
		assert.equal(result, "inactive");
	});

	it("reports inactive for a cancelled subscription, indistinguishably from a lapsed trial", async () => {
		const result = await resolveSharerPublicAccess(
			deps([SHARER], { [SHARER]: CANCELLED }),
			PREFIX,
		);
		assert.equal(result, "inactive");
	});

	it("keeps the perk when one of several prefix matches is still subscribed", async () => {
		const result = await resolveSharerPublicAccess(
			deps([SHARER, OTHER], { [SHARER]: TRIAL_EXPIRED, [OTHER]: PAID }),
			PREFIX,
		);
		assert.equal(result, "valid");
	});

	it("reports inactive when every prefix match has lapsed", async () => {
		const result = await resolveSharerPublicAccess(
			deps([SHARER, OTHER], { [SHARER]: TRIAL_EXPIRED, [OTHER]: CANCELLED }),
			PREFIX,
		);
		assert.equal(result, "inactive");
	});
});
