import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import type { InboxAddressEntry } from "@packages/domain/inbox";
import { INBOX_STYLES } from "./inbox.styles";
import { INBOX_COPYABLE_ADDRESS_STYLES } from "./inbox-copyable-address.styles";
import { renderCopyableAddress } from "./inbox-copyable-address.component";
import { toInboxAddressesViewModel, toInboxAlerts } from "./inbox.viewmodel";

const INBOX_TEMPLATE = readFileSync(join(__dirname, "inbox.template.html"), "utf-8");

const INBOX_SCRIPT = `<script src="/client-dist/inbox.client.js" defer></script>`;

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
		nameInvalid: params.nameInvalid === true,
		nameTaken: params.nameTaken === true,
		limitReached: params.limitReached,
	});
	const content = render(INBOX_TEMPLATE, {
		created: params.createdName !== undefined,
		createdName: params.createdName ?? "",
		...addresses,
		activeAddresses: addresses.activeAddresses.map((row) => ({
			...row,
			copyableHtml: renderCopyableAddress(row),
		})),
		alerts,
		// The input is flagged exactly when an alert carries the describedby
		// target, so aria-describedby can never point at an id that is not there.
		nameError: alerts.some((alert) => alert.id !== undefined),
		submittedName: params.submittedName,
		createAction: "/inbox/create",
		disableAction: "/inbox/disable",
		enableAction: "/inbox/enable",
	});

	return {
		seo: {
			title: "Your inbox emails — Readplace",
			description: "Your personal inbox emails for forwarding newsletters to Readplace.",
			canonicalUrl: "/inbox/addresses",
			robots: "noindex, nofollow",
		},
		styles: `${INBOX_STYLES}\n${INBOX_COPYABLE_ADDRESS_STYLES}`,
		bodyClass: "page-inbox",
		content: { html: content },
		scripts: INBOX_SCRIPT,
	};
}
