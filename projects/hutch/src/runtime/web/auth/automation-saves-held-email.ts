import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(
	join(__dirname, "automation-saves-held-email.template.html"),
	"utf-8",
);

export const AUTOMATION_SAVES_HELD_EMAIL_SUBJECT =
	"links sent to your Readplace inbox are waiting";

const SIGNOFF = "— Fayner";

interface AutomationSavesHeldEmailParams {
	founderAvatarUrl: string;
	inboxUrl: string;
	reactivateUrl: string;
	manageAddressesUrl: string;
}

interface AutomationSavesHeldEmailComponent {
	to: (mediaType: "text/html" | "text/plain") => string;
}

const CTA_LABEL = "See the articles waiting";

const OPENING_PARAGRAPH =
	"An email to your Readplace inbox just arrived, but the articles didn't go into your queue - your subscription is read-only, so saving is paused.";

const REASSURANCE_PREFIX =
	"Don't worry, you didn't lose anything. The email and the extracted articles are still in your inbox, and they go back to saving automatically once ";

const REASSURANCE_LINK_TEXT = "your subscription is active again";

function bodyParagraphs(reactivateUrl: string): { html: string; text: string }[] {
	return [
		{ html: OPENING_PARAGRAPH, text: OPENING_PARAGRAPH },
		{
			html: `${REASSURANCE_PREFIX}<a href="${reactivateUrl}" style="color:${EMAIL_COLORS.heading};">${REASSURANCE_LINK_TEXT}</a>.`,
			text: `${REASSURANCE_PREFIX}${REASSURANCE_LINK_TEXT}: ${reactivateUrl}`,
		},
	];
}

export function AutomationSavesHeldEmail(
	params: AutomationSavesHeldEmailParams,
): AutomationSavesHeldEmailComponent {
	const paragraphs = bodyParagraphs(params.reactivateUrl);
	return {
		to(mediaType) {
			if (mediaType === "text/html") {
				return render(TEMPLATE, {
					founderAvatarUrl: params.founderAvatarUrl,
					paragraphs: paragraphs.map((paragraph) => paragraph.html),
					ctaUrl: params.inboxUrl,
					ctaLabel: CTA_LABEL,
					manageAddressesUrl: params.manageAddressesUrl,
					signoff: SIGNOFF,
					colors: EMAIL_COLORS,
				});
			}

			return [
				...paragraphs.map((paragraph) => paragraph.text),
				`${CTA_LABEL}: ${params.inboxUrl}`,
				`If you'd rather not continue, turn off your inbox addresses and nothing more will be forwarded and you will stop receiving these emails: ${params.manageAddressesUrl}`,
				SIGNOFF,
			].join("\n\n");
		},
	};
}
