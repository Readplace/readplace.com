import assert from "node:assert";
import type { SavedArticle } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type { BuiltInClientName } from "@packages/supported-clients";
import { isIntentionalSave } from "../domain/engagement/intentional-save";
import { TrialDay3Email, type TrialDay3Install } from "../web/auth/trial-day3-email";
import { readSaves, sendTrialNudge, type TrialNudgeDeps } from "./send-trial-nudge";

const LISTED_SAVES = 5;
const BROWSER_EXTENSIONS: readonly BuiltInClientName[] = ["chrome", "firefox"];
const IPHONE_APP: BuiltInClientName = "iphone";

function installFor(saves: SavedArticle[]): TrialDay3Install | undefined {
	const clients = new Set<string>();
	for (const { provenance } of saves) {
		if (provenance?.kind === "client") clients.add(provenance.clientName);
	}
	if (!BROWSER_EXTENSIONS.some((client) => clients.has(client))) return "extension";
	return clients.has(IPHONE_APP) ? undefined : "iphone";
}

export async function sendTrialDay3Email(
	input: { userId: UserId; messageId: string },
	deps: TrialNudgeDeps,
): Promise<void> {
	await sendTrialNudge(
		{
			...input,
			kind: "trial_day3",
			compose: async ({ contact, trialEndsAt }) => {
				if (contact.earlyIntentionalSaves < 1) return undefined;
				const { registeredAt } = contact;
				assert(registeredAt, "a reader with early saves must carry registeredAt");
				const signup = Date.parse(registeredAt);
				const saves = await readSaves(
					{ userId: input.userId, order: "desc", keepReading: (savedAt) => savedAt.getTime() >= signup },
					deps,
				);
				const sinceSignup = saves.filter((save) => isIntentionalSave(save) && save.savedAt.getTime() >= signup);
				if (sinceSignup.length === 0) return undefined;
				return TrialDay3Email({
					items: sinceSignup.slice(0, LISTED_SAVES).map((save) => ({
						articleId: save.id,
						title: save.metadata.title,
						siteName: save.metadata.siteName,
					})),
					savedCount: sinceSignup.length,
					registeredAt,
					trialEndsAt,
					install: installFor(sinceSignup),
					appOrigin: deps.appOrigin,
					unsubscribeToken: deps.signUnsubscribeToken(input.userId),
				});
			},
		},
		deps,
	);
}
