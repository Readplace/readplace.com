import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { render } from "@packages/web-shell";
import { TRIAL_REMINDER_LEAD_DAYS } from "../../domain/stripe/stripe-trial-config";

const TEMPLATE = readFileSync(
	join(__dirname, "trial-reminder-email.template.html"),
	"utf-8",
);

export const TRIAL_REMINDER_EMAIL_SUBJECT = `your Readplace trial ends in ${TRIAL_REMINDER_LEAD_DAYS} days`;

const SIGNOFF = "— Fayner";

interface TrialReminderEmailParams {
	founderAvatarUrl: string;
	savedArticlesCount: number;
	ctaUrl: string;
}

interface TrialReminderEmailComponent {
	to: (mediaType: "text/html" | "text/plain") => string;
}

/** Returns the reassurance clause about already-saved articles that follows
 * "your account goes read-only" in the first paragraph. Returns an empty string
 * when the user saved zero articles so the sentence never fabricates usage. */
function usageClause(count: number): string {
	if (count === 0) return "";
	const noun = count === 1 ? "article" : "articles";
	return ` the ${count} ${noun} you've saved stay readable either way`;
}

function bodyParagraphs(clause: string): string[] {
	return [
		`Your trial of Readplace ends in ${TRIAL_REMINDER_LEAD_DAYS} days. I don't ask for a card up front, so nothing gets charged — when the trial ends your account goes read-only${clause ? `, but${clause}.` : "."}`,
		"There's no company behind Readplace — no investors, no team, just me. A subscription covers the cloud bills and pays for the hours that go into building Readplace and writing the posts on the blog, which stay free to read.",
		"If Readplace has earned a place in how you read, you can subscribe from your account page — it takes about a minute.",
		"If it hasn't, no action needed. Either way, I'd genuinely like to know what would make it worth keeping: just reply. I respond to all replies personally.",
	];
}

export function TrialReminderEmail(
	params: TrialReminderEmailParams,
): TrialReminderEmailComponent {
	const paragraphs = bodyParagraphs(usageClause(params.savedArticlesCount));
	return {
		to(mediaType) {
			if (mediaType === "text/html") {
				return render(TEMPLATE, {
					founderAvatarUrl: params.founderAvatarUrl,
					paragraphs,
					ctaUrl: params.ctaUrl,
					signoff: SIGNOFF,
					colors: EMAIL_COLORS,
				});
			}

			return [...paragraphs, `Subscribe: ${params.ctaUrl}`, SIGNOFF].join("\n\n");
		},
	};
}
