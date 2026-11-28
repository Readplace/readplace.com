import { renderEmailCardMessage } from "../email-card";
import { EMAIL_REPLY_INVITATION } from "../email-copy";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchEmails } from "@packages/translations/hutch-emails";

const { t } = translator(hutchEmails, DEFAULT_LOCALE);

export const INBOX_FIRST_ARRIVAL_EMAIL_SUBJECT =
	"Your first email landed in your Readplace Inbox";

const SIGNOFF = "— Fayner Brack, Founder & CEO";

const CTA_LABEL = "See it in your Inbox";

const OPENING_BEFORE = "The first email to your custom email ";
const OPENING_AFTER = " just came through.";

const PARAGRAPH =
	"From here on, every email sent to that custom email shows up in your Inbox, and Readplace saves the articles it links to into All, your main readlist, so you can read them later.";

interface InboxFirstArrivalEmailParams {
	founderAvatarUrl: string;
	inboxAddress: string;
	inboxUrl: string;
}

interface InboxFirstArrivalEmailComponent {
	to: (mediaType: "text/html" | "text/plain") => string;
}

export function InboxFirstArrivalEmail(
	params: InboxFirstArrivalEmailParams,
): InboxFirstArrivalEmailComponent {
	const opening = {
		before: OPENING_BEFORE,
		address: params.inboxAddress,
		after: OPENING_AFTER,
	};
	return {
		to(mediaType) {
			if (mediaType === "text/html") {
				return renderEmailCardMessage({
					titleHtml: t("inboxFirstArrivalEmail.title"),
					founderAvatarUrl: params.founderAvatarUrl,
					paragraphs: [{ address: opening }, { html: PARAGRAPH }],
					cta: { url: params.inboxUrl, label: CTA_LABEL },
					notes: [{ text: EMAIL_REPLY_INVITATION }],
					signoff: SIGNOFF,
				});
			}

			return [
				`${opening.before}${opening.address}${opening.after}`,
				PARAGRAPH,
				`${CTA_LABEL}: ${params.inboxUrl}`,
				EMAIL_REPLY_INVITATION,
				SIGNOFF,
			].join("\n\n");
		},
	};
}
