import { buildCustomEmailsUrl, CUSTOM_EMAILS_PATH, INBOX_PATH, NEWSLETTERS_PATH } from "@packages/domain/inbox";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert, renderIllustration, renderToast, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import type { CustomEmailsOrigin, InboxAddressEntry } from "@packages/domain/inbox";
import { INBOX_STYLES } from "./inbox.styles";
import { INBOX_COPYABLE_ADDRESS_STYLES } from "./inbox-copyable-address.styles";
import { renderCopyableAddress } from "./inbox-copyable-address.component";
import { toInboxAddressesViewModel, toInboxAlerts, toInboxNameErrors } from "./inbox.viewmodel";

const INBOX_TEMPLATE = readFileSync(join(__dirname, "inbox.template.html"), "utf-8");

const INBOX_SCRIPT = `<script src="/client-dist/inbox.client.js" defer></script>`;

const INBOX_ADDRESSES_SOURCE = "inbox-addresses";

const STATUS_TOAST_DISMISS_MS = 6000;

const BACK_LINKS: Record<CustomEmailsOrigin, { href: string; label: string; content: string }> = {
	inbox: { href: INBOX_PATH, label: "Inbox", content: "back-to-inbox" },
	newsletters: { href: NEWSLETTERS_PATH, label: "Newsletters", content: "back-to-newsletters" },
};

function trackAddresses(href: string, content: string): string {
	return withInternalTracking(href, { source: INBOX_ADDRESSES_SOURCE, content });
}

export function InboxPage(params: {
	addresses: InboxAddressEntry[];
	createFailed?: boolean;
	nameInvalid?: boolean;
	nameTaken?: boolean;
	limitReached: boolean;
	createdName?: string;
	submittedName: string;
	origin: CustomEmailsOrigin;
}): PageBody {
	const back = BACK_LINKS[params.origin];
	const actionUrl = (subpath: string) => buildCustomEmailsUrl({ origin: params.origin, subpath, params: {} });
	const addresses = toInboxAddressesViewModel(params.addresses);
	const alerts = toInboxAlerts({
		createFailed: params.createFailed === true,
		limitReached: params.limitReached,
	});
	const nameErrors = toInboxNameErrors({
		nameInvalid: params.nameInvalid === true,
		nameTaken: params.nameTaken === true,
	});
	const statusToastHtml =
		params.createdName === undefined
			? ""
			: renderToast({
					message: `Created the inbox email "${params.createdName}" — it's live in the list below`,
					dismissMs: STATUS_TOAST_DISMISS_MS,
					actions: [],
				});
	const content = render(INBOX_TEMPLATE, {
		...addresses,
		activeAddresses: addresses.activeAddresses.map((row) => ({
			...row,
			copyableHtml: renderCopyableAddress(row),
		})),
		alertsHtml: alerts
			.map(({ key, title, body }) =>
				renderAlert({
					key,
					content: {
						variant: "error",
						title: { text: title, element: "p" },
						message: { text: body },
					},
				}),
			)
			.join(""),
		nameErrors,
		nameError: nameErrors.length > 0,
		statusToastHtml,
		emptyIllustrationHtml: renderIllustration("book-lightbulb"),
		submittedName: params.submittedName,
		backHref: trackAddresses(back.href, back.content),
		backLabel: back.label,
		createAction: trackAddresses(actionUrl("/create"), "create-address"),
		disableAction: trackAddresses(actionUrl("/disable"), "disable-address"),
		enableAction: trackAddresses(actionUrl("/enable"), "enable-address"),
	});

	return {
		seo: {
			title: "From Custom Emails — Readplace",
			description: "Your personal inbox emails for forwarding newsletters to Readplace.",
			canonicalUrl: CUSTOM_EMAILS_PATH,
			robots: "noindex, nofollow",
		},
		styles: `${INBOX_STYLES}\n${INBOX_COPYABLE_ADDRESS_STYLES}`,
		bodyClass: "page-inbox",
		content: { html: content },
		scripts: INBOX_SCRIPT,
	};
}
