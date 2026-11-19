import assert from "node:assert";
import type { EmailLinkOrdinal, InboxEmailLinkStore, InboxReadlistOutcome } from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolvePlanAccess } from "@packages/subscription-access";

type TriagedMessageAdmission =
	| { kind: "proceed" }
	| { kind: "skip"; reason: "already-decided" | "no-longer-selected" | "decision-failed" | "paid-plan-required" }
	| { kind: "wait" }
	| { kind: "paid-plan-required" };

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

const PAID_PLAN_REQUIRED_BY_SCOPE: Record<TriagedTarget["scope"], TriagedMessageAdmission> = {
	email: { kind: "paid-plan-required" },
	link: { kind: "skip", reason: "paid-plan-required" },
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
		if (resolvePlanAccess(await deps.findSubscriptionByUserId(userId), deps.now()) === "free") {
			return PAID_PLAN_REQUIRED_BY_SCOPE[target.scope];
		}
		return { kind: "proceed" };
	};
}
