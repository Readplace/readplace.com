import assert from "node:assert/strict";
import {
	GmailAccountEmailSchema,
	GmailHistoryImportJobIdSchema,
	GmailMessageIdSchema,
	ForwardableSenderSchema,
} from "@packages/domain/gmail";
import { type IngestionAttempt, messageIdentityKey, NormalizedMessageIdSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryEmailIdentity } from "./in-memory-email-identity";

const OWNER = UserIdSchema.parse("user-1");
const OTHER = UserIdSchema.parse("user-2");
const SENDER = ForwardableSenderSchema.parse("dan@tldr.tech");
const KEY = messageIdentityKey({ userId: OWNER, sender: SENDER, messageId: NormalizedMessageIdSchema.parse("m-1@tldr.tech") });
const FIRST_AT = new Date("2026-09-30T00:00:00.000Z");
const LATER_AT = new Date("2026-09-30T01:00:00.000Z");
const FORWARDED: IngestionAttempt = { origin: "receive", sesMessageId: "ses-1" };
const IMPORTED: IngestionAttempt = {
	origin: "gmail-import",
	jobId: GmailHistoryImportJobIdSchema.parse("0123456789abcdef0123456789abcdef"),
	accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	gmailMessageId: GmailMessageIdSchema.parse("18c2f0a1b2c3d4e5"),
};
const FORWARDED_ROW = "2026-09-30T00:00:00.000Z#<m-1@tldr.tech>";

describe("initInMemoryEmailIdentity", () => {
	it("claims an unseen identity for the first attempt and finds it afterwards", async () => {
		const identities = initInMemoryEmailIdentity();

		const result = await identities.claim({ key: KEY, userId: OWNER, receivedAtMessageId: FORWARDED_ROW, attempt: FORWARDED, now: FIRST_AT });

		const claim = { key: KEY, userId: OWNER, receivedAtMessageId: FORWARDED_ROW, attempt: FORWARDED, claimedAt: FIRST_AT.toISOString() };
		assert.deepEqual(result, { status: "claimed", claim });
		assert.deepEqual(await identities.find(KEY), claim);
	});

	it("recognises a redelivery of the same attempt and hands back the stored row id", async () => {
		const identities = initInMemoryEmailIdentity();
		await identities.claim({ key: KEY, userId: OWNER, receivedAtMessageId: FORWARDED_ROW, attempt: FORWARDED, now: FIRST_AT });

		const result = await identities.claim({
			key: KEY,
			userId: OWNER,
			receivedAtMessageId: "2026-09-30T05:00:00.000Z#<m-1@tldr.tech>",
			attempt: { origin: "receive", sesMessageId: "ses-1" },
			now: LATER_AT,
		});

		assert.equal(result.status, "same-attempt");
		assert.equal(result.claim.receivedAtMessageId, FORWARDED_ROW);
	});

	it("reports an identity another attempt holds as claimed elsewhere without replacing it", async () => {
		const identities = initInMemoryEmailIdentity();
		await identities.claim({ key: KEY, userId: OWNER, receivedAtMessageId: FORWARDED_ROW, attempt: FORWARDED, now: FIRST_AT });

		const result = await identities.claim({ key: KEY, userId: OWNER, receivedAtMessageId: "import-row", attempt: IMPORTED, now: LATER_AT });

		assert.equal(result.status, "claimed-elsewhere");
		assert.deepEqual(result.claim.attempt, FORWARDED);
		assert.deepEqual((await identities.find(KEY))?.attempt, FORWARDED);
	});

	it("lets a later attempt take over a claim whose attempt never wrote its row, keeping the row id", async () => {
		const identities = initInMemoryEmailIdentity();
		const claimed = await identities.claim({ key: KEY, userId: OWNER, receivedAtMessageId: FORWARDED_ROW, attempt: FORWARDED, now: FIRST_AT });

		assert.equal(await identities.takeOver({ previous: claimed.claim, attempt: IMPORTED, now: LATER_AT }), true);

		assert.deepEqual(await identities.find(KEY), {
			key: KEY,
			userId: OWNER,
			receivedAtMessageId: FORWARDED_ROW,
			attempt: IMPORTED,
			claimedAt: LATER_AT.toISOString(),
		});
	});

	it("refuses a takeover when another attempt already took the claim over", async () => {
		const identities = initInMemoryEmailIdentity();
		const claimed = await identities.claim({ key: KEY, userId: OWNER, receivedAtMessageId: FORWARDED_ROW, attempt: FORWARDED, now: FIRST_AT });
		await identities.takeOver({ previous: claimed.claim, attempt: IMPORTED, now: LATER_AT });

		assert.equal(await identities.takeOver({ previous: claimed.claim, attempt: { origin: "receive", sesMessageId: "ses-2" }, now: LATER_AT }), false);
		assert.deepEqual((await identities.find(KEY))?.attempt, IMPORTED);
	});

	it("refuses a takeover of a claim that no longer exists", async () => {
		const identities = initInMemoryEmailIdentity();
		const claimed = await identities.claim({ key: KEY, userId: OWNER, receivedAtMessageId: FORWARDED_ROW, attempt: FORWARDED, now: FIRST_AT });
		await identities.deleteAllByUserId(OWNER);

		assert.equal(await identities.takeOver({ previous: claimed.claim, attempt: IMPORTED, now: LATER_AT }), false);
		assert.equal(await identities.find(KEY), undefined);
	});

	it("deletes only the owner's claims", async () => {
		const identities = initInMemoryEmailIdentity();
		const othersKey = messageIdentityKey({ userId: OTHER, sender: SENDER, messageId: NormalizedMessageIdSchema.parse("m-1@tldr.tech") });
		await identities.claim({ key: KEY, userId: OWNER, receivedAtMessageId: FORWARDED_ROW, attempt: FORWARDED, now: FIRST_AT });
		await identities.claim({ key: othersKey, userId: OTHER, receivedAtMessageId: FORWARDED_ROW, attempt: FORWARDED, now: FIRST_AT });

		await identities.deleteAllByUserId(OWNER);

		assert.equal(await identities.find(KEY), undefined);
		assert.equal((await identities.find(othersKey))?.userId, OTHER);
	});
});
