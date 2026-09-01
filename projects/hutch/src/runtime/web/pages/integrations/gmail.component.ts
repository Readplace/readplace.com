import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { GMAIL_PAGE_STYLES } from "./gmail.styles";
import type { GmailPageViewModel, GmailPollViewModel } from "./gmail.viewmodel";
import { toGmailPollViewModel } from "./gmail.viewmodel";

const GMAIL_TEMPLATE = readFileSync(join(__dirname, "gmail.template.html"), "utf-8");
const GMAIL_POLL_TEMPLATE = readFileSync(join(__dirname, "gmail-poll.template.html"), "utf-8");

const GMAIL_COPY_SCRIPT = `<script src="/client-dist/integrations.client.js" defer></script>`;

export function renderGmailPoll(vm: GmailPollViewModel): string {
	return render(GMAIL_POLL_TEMPLATE, vm);
}

export function GmailPage(vm: GmailPageViewModel): PageBody {
	return {
		seo: {
			title: "Gmail — Readplace",
			description: "Forward newsletters from Gmail into your Readplace inboxes.",
			canonicalUrl: "/integrations/gmail",
			robots: "noindex, nofollow",
		},
		styles: GMAIL_PAGE_STYLES,
		bodyClass: "page-integrations-gmail",
		content: {
			html: render(GMAIL_TEMPLATE, {
				...vm,
				pollLine: renderGmailPoll(toGmailPollViewModel({ pollCount: 0 })),
			}),
		},
		scripts: GMAIL_COPY_SCRIPT,
	};
}
