import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { requireEnv } from "@packages/require-env";
import { GMAIL_PAGE_STYLES } from "./gmail.styles";
import type { GmailPageViewModel, GmailPollViewModel } from "./gmail.viewmodel";
import { toGmailPollViewModel } from "./gmail.viewmodel";

const GMAIL_TEMPLATE = readFileSync(join(__dirname, "gmail.template.html"), "utf-8");
const GMAIL_POLL_TEMPLATE = readFileSync(join(__dirname, "gmail-poll.template.html"), "utf-8");

const GMAIL_COPY_SCRIPT = `<script src="/client-dist/integrations.client.js" defer></script>`;

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");

const SETTINGS_SHOT = {
	src: `${STATIC_BASE_URL}/screenshots/gmail-see-all-settings.webp`,
	alt: "Gmail's toolbar with the gear icon circled, and the Quick settings panel below it with See all settings circled",
	width: 1440,
	height: 308,
} as const;

const FORWARDING_SHOT = {
	src: `${STATIC_BASE_URL}/screenshots/gmail-add-forwarding-address.webp`,
	alt: "Gmail's settings tabs with Forwarding and POP/IMAP circled, and the Add a forwarding address button circled",
	width: 1440,
	height: 282,
} as const;

export function renderGmailPoll(vm: GmailPollViewModel): string {
	return render(GMAIL_POLL_TEMPLATE, vm);
}

export function GmailPage(vm: GmailPageViewModel): PageBody {
	return {
		seo: {
			title: "Gmail — Readplace",
			description: "Forward each newsletter from Gmail into your Readplace inboxes.",
			canonicalUrl: "/integrations/gmail",
			robots: "noindex, nofollow",
		},
		styles: GMAIL_PAGE_STYLES,
		bodyClass: "page-integrations-gmail",
		content: {
			html: render(GMAIL_TEMPLATE, {
				...vm,
				settingsShot: SETTINGS_SHOT,
				forwardingShot: FORWARDING_SHOT,
				pollLine: renderGmailPoll(toGmailPollViewModel({ pollCount: 0 })),
			}),
		},
		scripts: GMAIL_COPY_SCRIPT,
	};
}
