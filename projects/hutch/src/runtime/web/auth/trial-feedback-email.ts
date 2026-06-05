import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { render } from "../render";

const TEMPLATE = readFileSync(
	join(__dirname, "trial-feedback-email.template.html"),
	"utf-8",
);

export const TRIAL_FEEDBACK_EMAIL_SUBJECT =
	"you tried Readplace — what was missing?";

const SIGNOFF = "— Fayner";

interface TrialFeedbackEmailParams {
	founderAvatarUrl: string;
	savedArticlesCount: number;
}

interface TrialFeedbackEmailComponent {
	to: (mediaType: "text/html" | "text/plain") => string;
}

/** Returns the saved-articles clause that follows "You started a trial of
 * Readplace" in both the plain-text and HTML bodies. Returns an empty string
 * when the user saved zero articles so the sentence reads naturally without
 * any fabricated usage. */
function usageClause(count: number): string {
	if (count === 0) return "";
	const noun = count === 1 ? "article" : "articles";
	return `, saved ${count} ${noun},`;
}

function bodyParagraphs(clause: string): string[] {
	return [
		`You started a trial of Readplace${clause} and decided not to continue. Which is completely fine. That decision is one of the most useful things I can learn from right now, so I'm asking directly: what was missing?`,
		"I'm not trying to change your mind or sell you anything. I'd rather know the real reason it didn't earn a place in how you read — a missing feature, the price, something that didn't work, or just that it didn't fit.",
		"The honest answer helps more than being nice. A sentence is good enough, and there's nothing to click. I respond to ALL replied personally, this is my promise 🤝 :D",
	];
}

export function TrialFeedbackEmail(
	params: TrialFeedbackEmailParams,
): TrialFeedbackEmailComponent {
	const paragraphs = bodyParagraphs(usageClause(params.savedArticlesCount));
	return {
		to(mediaType) {
			if (mediaType === "text/html") {
				return render(TEMPLATE, {
					founderAvatarUrl: params.founderAvatarUrl,
					paragraphs,
					signoff: SIGNOFF,
					colors: EMAIL_COLORS,
				});
			}

			return [...paragraphs, SIGNOFF].join("\n\n");
		},
	};
}
