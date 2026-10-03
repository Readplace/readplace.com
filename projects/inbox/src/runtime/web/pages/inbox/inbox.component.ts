import { CUSTOM_EMAILS_PATH } from "@packages/domain/inbox";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert, renderIllustration, renderToast, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import type { InboxAddressEntry } from "@packages/domain/inbox";
import { INBOX_STYLES } from "./inbox.styles";
import { INBOX_COPYABLE_ADDRESS_STYLES } from "./inbox-copyable-address.styles";
import { renderCopyableAddress } from "./inbox-copyable-address.component";
import { toInboxAddressesViewModel, toInboxAlerts, toInboxNameErrors } from "./inbox.viewmodel";

const INBOX_TEMPLATE = readFileSync(join(__dirname, "inbox.template.html"), "utf-8");

const INBOX_SCRIPT = `<script src="/client-dist/inbox.client.js" defer></script>`;

const INBOX_ADDRESSES_SOURCE = "inbox-addresses";

const STATUS_TOAST_DISMISS_MS = 6000;

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
}): PageBody {
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
		createAction: trackAddresses(`${CUSTOM_EMAILS_PATH}/create`, "create-address"),
		disableAction: trackAddresses(`${CUSTOM_EMAILS_PATH}/disable`, "disable-address"),
		enableAction: trackAddresses(`${CUSTOM_EMAILS_PATH}/enable`, "enable-address"),
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
