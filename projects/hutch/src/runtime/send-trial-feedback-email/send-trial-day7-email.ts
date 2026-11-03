import assert from "node:assert";
import type { UserId } from "@packages/domain/user";
import { isIntentionalSave } from "../domain/engagement/intentional-save";
import { TrialDay7Email } from "../web/auth/trial-day7-email";
import { readSaves, sendTrialNudge, type TrialNudgeDeps } from "./send-trial-nudge";

const LISTED_SAVES = 3;
const FIRST_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function sendTrialDay7Email(
	input: { userId: UserId; messageId: string },
	deps: TrialNudgeDeps,
): Promise<void> {
	await sendTrialNudge(
		{
			...input,
			kind: "trial_day7",
			compose: async ({ contact, trialEndsAt }) => {
				if (contact.earlyIntentionalSaves < 2) return undefined;
				const { registeredAt } = contact;
				assert(registeredAt, "a reader with early saves must carry registeredAt");
				const weekStart = Date.parse(registeredAt);
				const weekEnd = weekStart + FIRST_WEEK_MS;
				const inFirstWeek = (at: Date): boolean => at.getTime() >= weekStart && at.getTime() < weekEnd;
				const saves = await readSaves(
					{ userId: input.userId, order: "asc", keepReading: (savedAt) => savedAt.getTime() < weekEnd },
					deps,
				);
				const saved = saves.filter((save) => isIntentionalSave(save) && inFirstWeek(save.savedAt));
				const unread = saved.filter((save) => save.status === "unread");
				if (unread.length === 0) return undefined;
				const readCount = saved.filter(
					(save) => save.status === "read" && save.readAt !== undefined && inFirstWeek(save.readAt),
				).length;
				return TrialDay7Email({
					items: unread.slice(0, LISTED_SAVES).map((save) => ({
						articleId: save.id,
						title: save.metadata.title,
						siteName: save.metadata.siteName,
					})),
					savedCount: saved.length,
					readCount,
					registeredAt,
					trialEndsAt,
					appOrigin: deps.appOrigin,
					unsubscribeToken: deps.signUnsubscribeToken(input.userId),
				});
			},
		},
		deps,
	);
}
