import Handlebars from "handlebars";
import { EMAIL_COLORS } from "../email-colors";
import { renderEmailCardMessage } from "../email-card";
import { EMAIL_REPLY_INVITATION } from "../email-copy";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";

export const AUTOMATION_SAVES_HELD_EMAIL_SUBJECT =
	"links sent to your Readplace Inbox are waiting";

const SIGNOFF = "— Fayner Brack, Founder & CEO";

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

const { t } = translator(hutchEmails, DEFAULT_LOCALE);

const CTA_LABEL = t("automationSavesHeldEmail.ctaLabel");

const OPENING_AFTER = t("automationSavesHeldEmail.openingAfter");

function openingFragments(inboxAddress: string | undefined): {
	before: string;
	address: string;
	after: string;
} {
	return {
		before:
			inboxAddress === undefined
				? "An email"
				: "An email to ",
		address: inboxAddress ?? "",
		after: OPENING_AFTER,
	};
}

const REASSURANCE_PREFIX = t("automationSavesHeldEmail.reassurancePrefix");

const REASSURANCE_LINK_TEXT = t("automationSavesHeldEmail.reassuranceLink");

function bodyParagraphs(input: {
	reactivateUrl: string;
}): { html: string; text: string }[] {
	const reactivateUrl = input.reactivateUrl;
	return [
		{
			html: `${REASSURANCE_PREFIX}<a href="${reactivateUrl}" style="color:${EMAIL_COLORS.primaryText};">${REASSURANCE_LINK_TEXT}</a>.`,
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
				return renderEmailCardMessage({
					titleHtml: t("automationSavesHeldEmail.title"),
					founderAvatarUrl: params.founderAvatarUrl,
					paragraphs: [{ address: opening }, ...paragraphs.map((paragraph) => ({ html: paragraph.html }))],
					cta: { url: params.inboxUrl, label: CTA_LABEL },
					notes: [
						{ text: EMAIL_REPLY_INVITATION },
						{
							html: `${t("automationSavesHeldEmail.optOut.before")}<a href="${Handlebars.Utils.escapeExpression(params.manageAddressesUrl)}" style="color:${EMAIL_COLORS.primaryText};">${t("automationSavesHeldEmail.optOut.link")}</a>${t("automationSavesHeldEmail.optOut.after")}`,
						},
					],
					signoff: SIGNOFF,
				});
			}

			return [
				`${opening.before}${opening.address}${opening.after}`,
				...paragraphs.map((paragraph) => paragraph.text),
				`${CTA_LABEL}: ${params.inboxUrl}`,
				EMAIL_REPLY_INVITATION,
				`If you'd rather not continue, disable your custom emails and nothing more will be forwarded and you will stop receiving these emails: ${params.manageAddressesUrl}`,
				SIGNOFF,
			].join("\n\n");
		},
	};
}
