import { INBOX_PATH } from "@packages/domain/inbox";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { INBOX_EMAILS_STYLES } from "./inbox-emails.styles";
import { INBOX_COPYABLE_ADDRESS_STYLES } from "./inbox-copyable-address.styles";
import { renderCopyableAddress } from "./inbox-copyable-address.component";
import { toInboxAddressAriaLabels } from "./inbox.viewmodel";
import type {
	InboxEmailsEmptyViewModel,
	InboxEmailsViewModel,
	InboxEmptyAddressViewModel,
} from "./inbox-emails.viewmodel";

const INBOX_EMAILS_TEMPLATE = readFileSync(
	join(__dirname, "inbox-emails.template.html"),
	"utf-8",
);

const INBOX_SCRIPT = `<script src="/client-dist/inbox.client.js" defer></script>`;

interface InboxEmptyAddressDisplayModel extends InboxEmptyAddressViewModel {
	copyableHtml: string;
}

interface InboxEmptyDisplayModel extends Omit<InboxEmailsEmptyViewModel, "addresses"> {
	addresses: InboxEmptyAddressDisplayModel[];
}

interface InboxEmailsDisplayModel extends Omit<InboxEmailsViewModel, "empty"> {
	empty: InboxEmptyDisplayModel | undefined;
}

function toDisplayModel(vm: InboxEmailsViewModel): InboxEmailsDisplayModel {
	return {
		...vm,
		empty:
			vm.empty === undefined
				? undefined
				: {
						...vm.empty,
						addresses: vm.empty.addresses.map((entry) => ({
							...entry,
							copyableHtml: renderCopyableAddress({
								address: entry.address,
								...toInboxAddressAriaLabels(entry.name),
							}),
						})),
					},
	};
}

export function InboxEmailsPage(vm: InboxEmailsViewModel): PageBody {
	return {
		seo: {
			title: "Inbox — Readplace",
			description: "Newsletters forwarded to your Readplace inbox.",
			canonicalUrl: INBOX_PATH,
			// Personal data: never index a user's received mail.
			robots: "noindex, nofollow",
		},
		styles: `${INBOX_EMAILS_STYLES}\n${INBOX_COPYABLE_ADDRESS_STYLES}`,
		bodyClass: "page-inbox",
		content: { html: render(INBOX_EMAILS_TEMPLATE, toDisplayModel(vm)) },
		scripts: INBOX_SCRIPT,
	};
}
