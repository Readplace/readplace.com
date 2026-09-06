import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { EMAIL_REPLY_INVITATION } from "../email-copy";
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
	inboxAddress: string | undefined;
	inboxUrl: string;
	reactivateUrl: string;
	manageAddressesUrl: string;
}

interface AutomationSavesHeldEmailComponent {
	to: (mediaType: "text/html" | "text/plain") => string;
}

const CTA_LABEL = "See the articles waiting";

const OPENING_AFTER =
	" just arrived, but the articles didn't go into your queue - your subscription is read-only, so saving is paused.";

function openingFragments(inboxAddress: string | undefined): {
	before: string;
	address: string;
	after: string;
} {
	return {
		before:
			inboxAddress === undefined
				? "An email to your Readplace inbox"
				: "An email to your Readplace inbox at ",
		address: inboxAddress ?? "",
		after: OPENING_AFTER,
	};
}

const REASSURANCE_PREFIX =
	"Don't worry, you didn't lose anything. The email and the extracted articles are still in your inbox, and they go back to saving automatically once ";

const REASSURANCE_LINK_TEXT = "your subscription is active again";

function bodyParagraphs(input: {
	reactivateUrl: string;
}): { html: string; text: string }[] {
	const reactivateUrl = input.reactivateUrl;
	return [
		{
			html: `${REASSURANCE_PREFIX}<a href="${reactivateUrl}" style="color:${EMAIL_COLORS.heading};">${REASSURANCE_LINK_TEXT}</a>.`,
			text: `${REASSURANCE_PREFIX}${REASSURANCE_LINK_TEXT}: ${reactivateUrl}`,
		},
	];
}

export function AutomationSavesHeldEmail(
	params: AutomationSavesHeldEmailParams,
): AutomationSavesHeldEmailComponent {
	const paragraphs = bodyParagraphs({ reactivateUrl: params.reactivateUrl });
	const opening = openingFragments(params.inboxAddress);
	return {
		to(mediaType) {
			if (mediaType === "text/html") {
				return render(TEMPLATE, {
					founderAvatarUrl: params.founderAvatarUrl,
					opening,
					paragraphs: paragraphs.map((paragraph) => paragraph.html),
					ctaUrl: params.inboxUrl,
					ctaLabel: CTA_LABEL,
					replyLine: EMAIL_REPLY_INVITATION,
					manageAddressesUrl: params.manageAddressesUrl,
					signoff: SIGNOFF,
					colors: EMAIL_COLORS,
				});
			}

			return [
				`${opening.before}${opening.address}${opening.after}`,
				...paragraphs.map((paragraph) => paragraph.text),
				`${CTA_LABEL}: ${params.inboxUrl}`,
				EMAIL_REPLY_INVITATION,
				`If you'd rather not continue, turn off your inbox addresses and nothing more will be forwarded and you will stop receiving these emails: ${params.manageAddressesUrl}`,
				SIGNOFF,
			].join("\n\n");
		},
	};
}
