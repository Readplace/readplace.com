import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_COLORS } from "../email-colors";
import { EMAIL_REPLY_INVITATION } from "../email-copy";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(
	join(__dirname, "inbox-first-arrival-email.template.html"),
	"utf-8",
);

export const INBOX_FIRST_ARRIVAL_EMAIL_SUBJECT =
	"Your first email landed in your Readplace inbox";

const SIGNOFF = "— Fayner";

const CTA_LABEL = "See it in your inbox";

const OPENING_BEFORE = "The first email to your Readplace inbox at ";
const OPENING_AFTER = " just came through.";

const PARAGRAPH =
	"From here on, every email sent to that address shows up in your inbox, and I pull the article links out of it and add them to your queue so you can read them later.";

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
				return render(TEMPLATE, {
					founderAvatarUrl: params.founderAvatarUrl,
					opening,
					paragraphs: [PARAGRAPH],
					ctaUrl: params.inboxUrl,
					ctaLabel: CTA_LABEL,
					replyLine: EMAIL_REPLY_INVITATION,
					signoff: SIGNOFF,
					colors: EMAIL_COLORS,
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
