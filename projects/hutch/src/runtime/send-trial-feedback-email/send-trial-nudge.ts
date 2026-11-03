import assert from "node:assert";
import type { SavedArticle } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { FindArticlesByUser } from "@packages/provider-contracts/article-store";
import type { FindUserContactByUserId, UserContact } from "@packages/provider-contracts/auth";
import type { SendEmail } from "@packages/provider-contracts/email";
import type {
	ClaimTrialNudge,
	FindSubscriptionByUserId,
} from "@packages/provider-contracts/subscription-providers";
import type { TrialNudgeKind } from "@packages/provider-contracts/trial-scheduler";
import { trialDayOf } from "../domain/trial/trial-day";
import type { EmitLifecycleEmailSent } from "../observability/lifecycle-email-events";
import type { TrialNudgeEmail } from "../web/auth/trial-nudge-email";

const TRIAL_NUDGE_FROM = "Fayner from Readplace <fayner@readplace.com>";
const TRIAL_NUDGE_REPLY_TO = "fayner@readplace.com";
const SAVES_PAGE_SIZE = 50;

const NUDGE_COPY = {
	trial_day3: { label: "trial-day3", utmSource: "day3-email", bcc: "readplace+trial_day3@readplace.com" },
	trial_day7: { label: "trial-day7", utmSource: "day7-email", bcc: "readplace+trial_day7@readplace.com" },
} as const satisfies Record<TrialNudgeKind, { label: string; utmSource: string; bcc: string }>;

export interface TrialNudgeDeps {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	findUserContactByUserId: FindUserContactByUserId;
	findArticlesByUser: FindArticlesByUser;
	claimTrialNudge: ClaimTrialNudge;
	signUnsubscribeToken: (userId: UserId) => string;
	sendEmail: SendEmail;
	appOrigin: string;
	now: () => Date;
	logger: HutchLogger;
	emitLifecycleEmailSent: EmitLifecycleEmailSent;
}

export type ComposeTrialNudge = (input: {
	contact: UserContact;
	trialEndsAt: string;
}) => Promise<TrialNudgeEmail | undefined>;

export async function sendTrialNudge(
	input: { userId: UserId; messageId: string; kind: TrialNudgeKind; compose: ComposeTrialNudge },
	deps: TrialNudgeDeps,
): Promise<void> {
	const { userId, messageId, kind } = input;
	const copy = NUDGE_COPY[kind];
	const skip = (reason: string): void => {
		deps.logger.info(`[send-trial-feedback-email] ${kind} noop`, { userId, reason });
	};
	const now = deps.now();

	const row = await deps.findSubscriptionByUserId(userId);
	if (row?.status !== "trialing") return skip("not-trialing");
	assert(row.trialEndsAt, "a trialing row must carry trialEndsAt");
	if (Date.parse(row.trialEndsAt) <= now.getTime()) return skip("not-trialing");

	const contact = await deps.findUserContactByUserId(userId);
	if (!contact?.emailVerified) return skip("unverified");
	if (contact.queueDigestOptOutAt !== undefined) return skip("opted-out");

	const email = await input.compose({ contact, trialEndsAt: row.trialEndsAt });
	if (email === undefined) return skip("not-eligible");

	const claim = await deps.claimTrialNudge({ userId, kind, messageId, now });
	if (!claim.claimed) return skip("already-sent");

	await deps.sendEmail({
		to: contact.email,
		from: TRIAL_NUDGE_FROM,
		replyTo: TRIAL_NUDGE_REPLY_TO,
		bcc: copy.bcc,
		subject: email.subject,
		html: email.to("text/html"),
		text: email.to("text/plain"),
		headers: email.headers,
		idempotencyKey: `${copy.label}-${userId}`,
	});
	deps.emitLifecycleEmailSent({
		userId,
		kind: copy.label,
		trialDay: trialDayOf({ trialEndsAt: row.trialEndsAt, at: now }),
		utmSource: copy.utmSource,
		delivery: "automated",
	});
	deps.logger.info(`[send-trial-feedback-email] ${kind} sent`, { userId, messageId });
}

export async function readSaves(
	input: { userId: UserId; order: "asc" | "desc"; keepReading: (savedAt: Date) => boolean },
	deps: { findArticlesByUser: FindArticlesByUser },
): Promise<SavedArticle[]> {
	const saves: SavedArticle[] = [];
	for (let page = 1; ; page += 1) {
		const { articles, hasMore } = await deps.findArticlesByUser({
			userId: input.userId,
			excludeContent: true,
			sort: "savedAt",
			order: input.order,
			pageSize: SAVES_PAGE_SIZE,
			page,
		});
		saves.push(...articles);
		if (!hasMore) return saves;
		const last = articles.at(-1);
		assert(last, "a page that has more after it cannot be empty");
		if (!input.keepReading(last.savedAt)) return saves;
	}
}
