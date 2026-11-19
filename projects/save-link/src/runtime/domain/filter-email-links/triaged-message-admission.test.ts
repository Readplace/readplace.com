import assert from "node:assert/strict";
import { EmailLinkOrdinalSchema, type InboxReadlistOutcome } from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import { initAdmitTriagedMessage } from "./triaged-message-admission";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const RAM = "2026-09-23T09:00:00.000Z#<m-1@example.com>";
const WORK = ReadlistSlugSchema.parse("a1b2c3d4");
const HOME = ReadlistSlugSchema.parse("e5f6a7b8");
const NOW = new Date("2026-09-23T09:00:00.000Z");

type Meta = Parameters<ReturnType<typeof initInMemoryInboxEmailLink>["putLinksMeta"]>[0]["meta"];

function freeSubscription(): SubscriptionRecord {
	return {
		userId: USER,
		provider: "stripe",
		status: "cancelled",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
	};
}

async function admit(opts: {
	meta?: Meta;
	outcome?: Omit<InboxReadlistOutcome, "readlist" | "readlistLabel" | "fit"> & { fit?: InboxReadlistOutcome["fit"] };
	subscription?: SubscriptionRecord;
	target?: Parameters<ReturnType<typeof initAdmitTriagedMessage>>[0]["target"];
}) {
	const inboxLinks = initInMemoryInboxEmailLink();
	if (opts.meta !== undefined) {
		await inboxLinks.putLinksMeta({ userId: USER, receivedAtMessageId: RAM, meta: opts.meta });
	}
	if (opts.outcome !== undefined) {
		await inboxLinks.putReadlistOutcome({
			userId: USER,
			receivedAtMessageId: RAM,
			outcome: { readlist: WORK, readlistLabel: "Work", fit: [], ...opts.outcome },
		});
	}
	const admitTriagedMessage = initAdmitTriagedMessage({
		listLinksByEmail: inboxLinks.listLinksByEmail,
		findSubscriptionByUserId: async () => opts.subscription,
		now: () => NOW,
	});
	return admitTriagedMessage({
		userId: USER,
		receivedAtMessageId: RAM,
		readlist: WORK,
		target: opts.target ?? { scope: "email" },
	});
}

const SELECTS_WORK: Meta = {
	truncated: false,
	extractionFailed: false,
	selectedReadlists: [{ readlist: WORK, label: "Work" }],
};

describe("initAdmitTriagedMessage", () => {
	it("an absent outcome proceeds to a decision", async () => {
		assert.deepEqual(await admit({ meta: SELECTS_WORK }), { kind: "proceed" });
	});

	it.each(["filtered", "no-purpose", "readlist-missing"] as const)(
		"a message for a %s outcome is skipped as already decided",
		async (decision) => {
			assert.deepEqual(await admit({ meta: SELECTS_WORK, outcome: { decision } }), {
				kind: "skip",
				reason: "already-decided",
			});
		},
	);

	it.each<[string, Meta | undefined]>([
		["an email with no meta", undefined],
		["meta with no selected readlists", { truncated: false, extractionFailed: false }],
		[
			"meta selecting only another readlist",
			{ truncated: false, extractionFailed: false, selectedReadlists: [{ readlist: HOME, label: "Home" }] },
		],
	])("%s is skipped as no longer selected", async (_name, meta) => {
		assert.deepEqual(await admit({ meta }), { kind: "skip", reason: "no-longer-selected" });
	});

	it("a free account returns paid-plan-required", async () => {
		assert.deepEqual(await admit({ meta: SELECTS_WORK, subscription: freeSubscription() }), {
			kind: "paid-plan-required",
		});
	});

	it("a trial account proceeds", async () => {
		const trial: SubscriptionRecord = {
			userId: USER,
			provider: "stripe",
			status: "trialing",
			trialEndsAt: "2026-09-30T09:00:00.000Z",
			createdAt: "2026-09-16T09:00:00.000Z",
			updatedAt: "2026-09-16T09:00:00.000Z",
		};
		assert.deepEqual(await admit({ meta: SELECTS_WORK, subscription: trial }), { kind: "proceed" });
	});

	it("a failed outcome on a paid plan proceeds", async () => {
		assert.deepEqual(await admit({ meta: SELECTS_WORK, outcome: { decision: "failed" } }), { kind: "proceed" });
	});

	describe("a single saved link", () => {
		const RESCUED = EmailLinkOrdinalSchema.parse("0004");
		const target = { scope: "link" as const, ordinal: RESCUED };
		const decided = { ordinal: EmailLinkOrdinalSchema.parse("0000"), verdict: "keep" as const, reason: "On topic" };

		it("proceeds when the readlist decided the email without this link", async () => {
			assert.deepEqual(await admit({ meta: SELECTS_WORK, outcome: { decision: "filtered", fit: [decided] }, target }), {
				kind: "proceed",
			});
		});

		it.each(["no-purpose", "readlist-missing"] as const)("proceeds after a %s decision", async (decision) => {
			assert.deepEqual(await admit({ meta: SELECTS_WORK, outcome: { decision }, target }), { kind: "proceed" });
		});

		it("is skipped as already decided when the readlist already judged this link", async () => {
			assert.deepEqual(
				await admit({
					meta: SELECTS_WORK,
					outcome: { decision: "filtered", fit: [decided, { ...decided, ordinal: RESCUED }] },
					target,
				}),
				{ kind: "skip", reason: "already-decided" },
			);
		});

		it("is skipped when the readlist's decision for the email failed", async () => {
			assert.deepEqual(await admit({ meta: SELECTS_WORK, outcome: { decision: "failed" }, target }), {
				kind: "skip",
				reason: "decision-failed",
			});
		});

		it("is skipped for a free account, leaving the email's decision as it stands", async () => {
			assert.deepEqual(
				await admit({
					meta: SELECTS_WORK,
					outcome: { decision: "filtered", fit: [decided] },
					target,
					subscription: freeSubscription(),
				}),
				{ kind: "skip", reason: "paid-plan-required" },
			);
		});

		it("waits while the readlist has not decided the email yet", async () => {
			assert.deepEqual(await admit({ meta: SELECTS_WORK, target }), { kind: "wait" });
		});

		it("is skipped when the readlist is no longer selected", async () => {
			assert.deepEqual(await admit({ meta: { truncated: false, extractionFailed: false }, target }), {
				kind: "skip",
				reason: "no-longer-selected",
			});
		});
	});
});
