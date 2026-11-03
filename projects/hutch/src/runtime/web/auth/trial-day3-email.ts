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

const TEMPLATE = readFileSync(join(__dirname, "trial-day3-email.template.html"), "utf-8");

const REPLY_INVITATION = "If something didn't save the way you expected, reply to this email — it comes straight to me.";

export type TrialDay3Install = "extension" | "iphone";

const INSTALL_COPY: Record<TrialDay3Install, { paragraph: string; label: string; path: string; content: string }> = {
	extension: {
		paragraph: "On your computer, the browser extension saves the page you're on in one click, so the next one doesn't wait for you to come back here.",
		label: "Add the extension",
		path: "/install",
		content: "install-extension",
	},
	iphone: {
		paragraph: "On your iPhone, the Readplace app adds Readplace to the share sheet, so an article in Safari, Mail or a newsletter app is one tap from your readlist.",
		label: "Get the iPhone app",
		path: "/install?client=iphone",
		content: "install-iphone",
	},
};

export function TrialDay3Email(params: {
	items: TrialNudgeEmailItem[];
	savedCount: number;
	registeredAt: string;
	trialEndsAt: string;
	install: TrialDay3Install | undefined;
	appOrigin: string;
	unsubscribeToken: string;
}): TrialNudgeEmail {
	const { items, savedCount } = params;
	const single = savedCount === 1;
	const subject = single ? "the article you saved in Readplace" : `the ${savedCount} articles you've saved in Readplace`;
	const heading = single ? "Your first save" : `Your first ${savedCount} saves`;
	const signupDate = toAbsoluteDate({ iso: params.registeredAt }).label;
	const trialEnd = toAbsoluteDate({ iso: params.trialEndsAt }).label;
	const intro = single
		? `You've saved 1 article since ${signupDate}. Here it is:`
		: `You've saved ${savedCount} articles since ${signupDate}. Here they are:`;
	const pricing = `Choose during your trial: ${RENEWAL_PRICES} Add a card now and nothing is charged until ${trialEnd}; you'll get an email a week before. Your saves stay readable and exportable either way.`;
	const rest = savedCount - items.length;
	const moreLine = rest > 0 ? `and ${rest} more in your readlist.` : undefined;
	const footerReason = `You're getting this because you started a Readplace trial on ${signupDate}.`;
	const links = trialNudgeLinks({
		source: "day3-email",
		unsubscribeKind: "trial-day3",
		appOrigin: params.appOrigin,
		unsubscribeToken: params.unsubscribeToken,
	});
	const listed = items.map((item) => ({ ...item, url: links.article(item.articleId) }));
	const installCopy = params.install && INSTALL_COPY[params.install];
	const install = installCopy && {
		paragraph: installCopy.paragraph,
		label: installCopy.label,
		url: links.to(installCopy.path, installCopy.content),
	};
	const keepUrl = links.keep();
	const unsubscribeUrl = links.unsubscribe();

	return {
		subject,
		headers: links.headers,
		to(mediaType) {
			if (mediaType === "text/plain") {
				return [
					heading,
					intro,
					...listed.map((item) => `- ${item.title} — ${item.siteName}\n${item.url}`),
					...(moreLine ? [moreLine] : []),
					...(install ? [install.paragraph, `${install.label}: ${install.url}`] : []),
					pricing,
					`${KEEP_READPLACE_LABEL}: ${keepUrl}`,
					REPLY_INVITATION,
					TRIAL_NUDGE_SIGNOFF,
					`${footerReason} ${UNSUBSCRIBE_LABEL}: ${unsubscribeUrl} · Proficient Pty Ltd, ${EMAIL_POSTAL_ADDRESS}`,
				].join("\n\n");
			}
			return render(TEMPLATE, {
				subject,
				heading,
				intro,
				items: listed,
				moreLine,
				install,
				pricing,
				keepLabel: KEEP_READPLACE_LABEL,
				keepUrl,
				replyInvitation: REPLY_INVITATION,
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
