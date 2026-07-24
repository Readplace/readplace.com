import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { INBOX_EMAILS_STYLES } from "./inbox-emails.styles";
import type { InboxEmailsViewModel } from "./inbox-emails.viewmodel";

const INBOX_EMAILS_TEMPLATE = readFileSync(
	join(__dirname, "inbox-emails.template.html"),
	"utf-8",
);

const INBOX_SCRIPT = `<script src="/client-dist/inbox.client.js" defer></script>`;

export function InboxEmailsPage(vm: InboxEmailsViewModel): PageBody {
	return {
		seo: {
			title: "Inbox — Readplace",
			description: "Newsletters forwarded to your Readplace inbox.",
			canonicalUrl: "/inbox",
			// Personal data: never index a user's received mail.
			robots: "noindex, nofollow",
		},
		styles: INBOX_EMAILS_STYLES,
		bodyClass: "page-inbox",
		content: { html: render(INBOX_EMAILS_TEMPLATE, vm) },
		scripts: INBOX_SCRIPT,
	};
}
