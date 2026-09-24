import { INBOX_PATH } from "@packages/domain/inbox";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderIllustration } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { INBOX_EMAILS_STYLES } from "./inbox-emails.styles";
import { INBOX_COPYABLE_ADDRESS_STYLES } from "./inbox-copyable-address.styles";
import { renderCopyableAddress } from "./inbox-copyable-address.component";
import { toInboxAddressAriaLabels } from "./inbox.viewmodel";
import type {
	InboxEmailsEmptyViewModel,
	InboxEmailsPaginationLink,
	InboxEmailsViewModel,
	InboxEmptyAddressViewModel,
} from "./inbox-emails.viewmodel";

const INBOX_EMAILS_TEMPLATE = readFileSync(
	join(__dirname, "inbox-emails.template.html"),
	"utf-8",
);

const INBOX_SCRIPT = `<script src="/client-dist/inbox.client.js" defer></script>`;

const EMPTY_ILLUSTRATION_HTML = renderIllustration("book-lightbulb");

const PAGINATION_DIRECTION_CLASS: Record<InboxEmailsPaginationLink["key"], string> = {
	newer: "inbox-emails__pagination-link--newer",
	older: "inbox-emails__pagination-link--older",
};

interface InboxEmptyAddressDisplayModel extends InboxEmptyAddressViewModel {
	copyableHtml: string;
}

interface InboxEmptyDisplayModel extends Omit<InboxEmailsEmptyViewModel, "addresses"> {
	addresses: InboxEmptyAddressDisplayModel[];
	illustrationHtml: string;
}

interface InboxEmailsPaginationDisplayLink extends InboxEmailsPaginationLink {
	directionClass: string;
}

interface InboxEmailsDisplayModel extends Omit<InboxEmailsViewModel, "empty" | "paginationLinks"> {
	empty: InboxEmptyDisplayModel | undefined;
	paginationLinks: InboxEmailsPaginationDisplayLink[];
}

function toDisplayModel(vm: InboxEmailsViewModel): InboxEmailsDisplayModel {
	return {
		...vm,
		empty:
			vm.empty === undefined
				? undefined
				: {
						...vm.empty,
						illustrationHtml: EMPTY_ILLUSTRATION_HTML,
						addresses: vm.empty.addresses.map((entry) => ({
							...entry,
							copyableHtml: renderCopyableAddress({
								address: entry.address,
								...toInboxAddressAriaLabels(entry.name),
							}),
						})),
					},
		paginationLinks: vm.paginationLinks.map((link) => ({
			...link,
			directionClass: PAGINATION_DIRECTION_CLASS[link.key],
		})),
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
