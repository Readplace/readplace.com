import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, toAbsoluteDate } from "@packages/web-shell";
import { EMAIL_COLORS, EMAIL_FONT_STACK } from "../email-colors";
import { EMAIL_POSTAL_ADDRESS } from "../email-copy";
import { RENEWAL_PRICES } from "../price-statement";
import { KEEP_READPLACE_LABEL, UNSUBSCRIBE_LABEL } from "../queue-digest-email";
import {
	TRIAL_NUDGE_SIGNOFF,
	trialNudgeLinks,
	type TrialNudgeEmail,
	type TrialNudgeEmailItem,
} from "./trial-nudge-email";

const TEMPLATE = readFileSync(join(__dirname, "trial-day7-email.template.html"), "utf-8");

const SUBJECT = "Your readlist, a week in";
const WAITING_LINE = "Still waiting for you:";
const CONTINUE_LABEL = "Continue reading";

export function TrialDay7Email(params: {
	items: TrialNudgeEmailItem[];
	savedCount: number;
	readCount: number;
	registeredAt: string;
	trialEndsAt: string;
	appOrigin: string;
	unsubscribeToken: string;
}): TrialNudgeEmail {
	const { savedCount, readCount } = params;
	const savedPhrase = savedCount === 1 ? "1 article" : `${savedCount} articles`;
	const readPhrase = readCount > 0 ? ` and read ${readCount}` : "";
	const intro = `In your first week you saved ${savedPhrase}${readPhrase}.`;
	const signupDate = toAbsoluteDate({ iso: params.registeredAt }).label;
	const trialEnd = toAbsoluteDate({ iso: params.trialEndsAt }).label;
	const pricing = `Your trial ends on ${trialEnd}. Choose during your trial: ${RENEWAL_PRICES} Add a card now and nothing is charged until ${trialEnd}; you'll get a reminder before the charge. Your saves stay readable and exportable either way.`;
	const footerReason = `You're getting this because you started a Readplace trial on ${signupDate}.`;
	const links = trialNudgeLinks({
		source: "day7-email",
		unsubscribeKind: "trial-day7",
		appOrigin: params.appOrigin,
		unsubscribeToken: params.unsubscribeToken,
	});
	const listed = params.items.map((item) => ({ ...item, url: links.article(item.articleId) }));
	const continueUrl = links.to("/queue", "readlist");
	const keepUrl = links.keep();
	const unsubscribeUrl = links.unsubscribe();

	return {
		subject: SUBJECT,
		headers: links.headers,
		to(mediaType) {
			if (mediaType === "text/plain") {
				return [
					SUBJECT,
					intro,
					WAITING_LINE,
					...listed.map((item) => `- ${item.title} — ${item.siteName}\n${item.url}`),
					`${CONTINUE_LABEL}: ${continueUrl}`,
					pricing,
					`${KEEP_READPLACE_LABEL}: ${keepUrl}`,
					TRIAL_NUDGE_SIGNOFF,
					`${footerReason} ${UNSUBSCRIBE_LABEL}: ${unsubscribeUrl} · Proficient Pty Ltd, ${EMAIL_POSTAL_ADDRESS}`,
				].join("\n\n");
			}
			return render(TEMPLATE, {
				subject: SUBJECT,
				intro,
				waitingLine: WAITING_LINE,
				items: listed,
				continueLabel: CONTINUE_LABEL,
				continueUrl,
				pricing,
				keepLabel: KEEP_READPLACE_LABEL,
				keepUrl,
				signoff: TRIAL_NUDGE_SIGNOFF,
				footerReason,
				unsubscribeUrl,
				unsubscribeLabel: UNSUBSCRIBE_LABEL,
				postalAddress: EMAIL_POSTAL_ADDRESS,
				colors: EMAIL_COLORS,
				fontStack: EMAIL_FONT_STACK,
			});
		},
	};
}
