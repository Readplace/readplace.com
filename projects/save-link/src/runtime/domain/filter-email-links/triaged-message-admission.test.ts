import assert from "node:assert/strict";
import type { InboxReadlistOutcome } from "@packages/domain/inbox";
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

function lapsedSubscription(): SubscriptionRecord {
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
	outcome?: Omit<InboxReadlistOutcome, "readlist" | "readlistLabel" | "fit">;
	subscription?: SubscriptionRecord;
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
	return admitTriagedMessage({ userId: USER, receivedAtMessageId: RAM, readlist: WORK });
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

	it("a read-only account returns write-access-lapsed", async () => {
		assert.deepEqual(await admit({ meta: SELECTS_WORK, subscription: lapsedSubscription() }), {
			kind: "write-access-lapsed",
		});
	});

	it("a failed outcome with full access proceeds", async () => {
		assert.deepEqual(await admit({ meta: SELECTS_WORK, outcome: { decision: "failed" } }), { kind: "proceed" });
	});
});
