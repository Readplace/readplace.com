import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_FEATURE, render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { INBOX_ADDRESS_MAX_PER_USER, type InboxAddressEntry } from "@packages/domain/inbox";
import { INBOX_STYLES } from "./inbox.styles";

const INBOX_TEMPLATE = readFileSync(join(__dirname, "inbox.template.html"), "utf-8");

const INBOX_SCRIPT = `<script src="/client-dist/inbox.client.js" defer></script>`;

/** The create/disable forms must carry the per-request flag in their action so
 * the gated POST routes stay reachable when submitted from the flagged page. */
const INBOX_QUERY = `?feature=${EMAIL_FEATURE}`;

export function InboxPage(params: {
	addresses: InboxAddressEntry[];
	createFailed?: boolean;
	nameInvalid?: boolean;
	nameTaken?: boolean;
	limitReached: boolean;
}): PageBody {
	const content = render(INBOX_TEMPLATE, {
		createFailed: params.createFailed === true,
		nameInvalid: params.nameInvalid === true,
		nameTaken: params.nameTaken === true,
		hasAddresses: params.addresses.length > 0,
		addresses: params.addresses.map((entry) => ({
			address: entry.address,
			name: entry.name,
			enabled: entry.disabledAt === undefined,
		})),
		limitReached: params.limitReached,
		maxAddresses: INBOX_ADDRESS_MAX_PER_USER,
		createAction: `/inbox/create${INBOX_QUERY}`,
		disableAction: `/inbox/disable${INBOX_QUERY}`,
	});

	return {
		seo: {
			title: "Your forwarding addresses — Readplace",
			description: "Your personal email forwarding addresses for Readplace.",
			canonicalUrl: "/inbox/addresses",
			robots: "noindex, nofollow",
		},
		styles: INBOX_STYLES,
		bodyClass: "page-inbox",
		content: { html: content },
		scripts: INBOX_SCRIPT,
	};
}
