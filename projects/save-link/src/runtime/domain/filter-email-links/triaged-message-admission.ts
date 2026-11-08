import assert from "node:assert";
import type { InboxEmailLinkStore } from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolveWriteAccess } from "@packages/subscription-access";

type TriagedMessageAdmission =
	| { kind: "proceed" }
	| { kind: "skip"; reason: "already-decided" | "no-longer-selected" }
	| { kind: "write-access-lapsed" };

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
		if (resolveWriteAccess(await deps.findSubscriptionByUserId(userId), deps.now()) === "read-only") {
			return { kind: "write-access-lapsed" };
		}
		return { kind: "proceed" };
	};
}
