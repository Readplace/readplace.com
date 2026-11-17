import assert from "node:assert";
import type { EmailLinkOrdinal, InboxEmailLinkStore, InboxReadlistOutcome } from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolveWriteAccess } from "@packages/subscription-access";

type TriagedMessageAdmission =
	| { kind: "proceed" }
	| { kind: "skip"; reason: "already-decided" | "no-longer-selected" | "decision-failed" | "write-access-lapsed" }
	| { kind: "wait" }
	| { kind: "write-access-lapsed" };

type TriagedTarget = { scope: "email" } | { scope: "link"; ordinal: EmailLinkOrdinal };

const ADMIT_BY_SCOPE = {
	email: (outcome: InboxReadlistOutcome | undefined): TriagedMessageAdmission | undefined =>
		outcome !== undefined && outcome.decision !== "failed" ? { kind: "skip", reason: "already-decided" } : undefined,
	link: (outcome: InboxReadlistOutcome | undefined, ordinal: EmailLinkOrdinal): TriagedMessageAdmission | undefined => {
		if (outcome === undefined) return { kind: "wait" };
		if (outcome.decision === "failed") return { kind: "skip", reason: "decision-failed" };
		if (outcome.fit.some((entry) => entry.ordinal === ordinal)) return { kind: "skip", reason: "already-decided" };
		return undefined;
	},
};

const LAPSED_BY_SCOPE: Record<TriagedTarget["scope"], TriagedMessageAdmission> = {
	email: { kind: "write-access-lapsed" },
	link: { kind: "skip", reason: "write-access-lapsed" },
};

export function initAdmitTriagedMessage(deps: {
	listLinksByEmail: InboxEmailLinkStore["listLinksByEmail"];
	findSubscriptionByUserId: FindSubscriptionByUserId;
	now: () => Date;
}) {
	return async (input: {
		userId: UserId;
		receivedAtMessageId: string;
		readlist: ReadlistSlug;
		target: TriagedTarget;
	}): Promise<TriagedMessageAdmission> => {
		const { userId, receivedAtMessageId, readlist, target } = input;
		const { meta } = await deps.listLinksByEmail({ userId, receivedAtMessageId });
		if (!meta?.selectedReadlists?.some((selected) => selected.readlist === readlist)) {
			return { kind: "skip", reason: "no-longer-selected" };
		}
		assert(meta.readlistOutcomes, "a meta row that selects readlists carries its outcome rows");
		const outcome = meta.readlistOutcomes.find((entry) => entry.readlist === readlist);
		const settled =
			target.scope === "email" ? ADMIT_BY_SCOPE.email(outcome) : ADMIT_BY_SCOPE.link(outcome, target.ordinal);
		if (settled !== undefined) return settled;
		if (resolveWriteAccess(await deps.findSubscriptionByUserId(userId), deps.now()) === "read-only") {
			return LAPSED_BY_SCOPE[target.scope];
		}
		return { kind: "proceed" };
	};
}
