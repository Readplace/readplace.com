import assert from "node:assert";
import type { InboxEmailLinkStore } from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolvePlanAccess } from "@packages/subscription-access";

type TriagedMessageAdmission =
	| { kind: "proceed" }
	| { kind: "skip"; reason: "already-decided" | "no-longer-selected" }
	| { kind: "paid-plan-required" };

export function initAdmitTriagedMessage(deps: {
	listLinksByEmail: InboxEmailLinkStore["listLinksByEmail"];
	findSubscriptionByUserId: FindSubscriptionByUserId;
	now: () => Date;
}) {
	return async (input: {
		userId: UserId;
		receivedAtMessageId: string;
		readlist: ReadlistSlug;
	}): Promise<TriagedMessageAdmission> => {
		const { userId, receivedAtMessageId, readlist } = input;
		const { meta } = await deps.listLinksByEmail({ userId, receivedAtMessageId });
		if (!meta?.selectedReadlists?.some((selected) => selected.readlist === readlist)) {
			return { kind: "skip", reason: "no-longer-selected" };
		}
		assert(meta.readlistOutcomes, "a meta row that selects readlists carries its outcome rows");
		const outcome = meta.readlistOutcomes.find((entry) => entry.readlist === readlist);
		if (outcome !== undefined && outcome.decision !== "failed") return { kind: "skip", reason: "already-decided" };
		if (resolvePlanAccess(await deps.findSubscriptionByUserId(userId), deps.now()) === "free") {
			return { kind: "paid-plan-required" };
		}
		return { kind: "proceed" };
	};
}
