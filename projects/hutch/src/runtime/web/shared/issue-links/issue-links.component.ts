import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSaveableUrl } from "@packages/domain/article";
import {
	type EmailLinkOrdinal,
	type InboxEmailLinkEntry,
	type InboxLinkSaveState,
	isExcludedLink,
} from "@packages/domain/inbox";
import { render } from "@packages/web-shell";

const ISSUE_LINKS_TEMPLATE = readFileSync(join(__dirname, "issue-links.template.html"), "utf-8");

export interface IssueLinksSectionInput {
	links: readonly InboxEmailLinkEntry[];
	extraction: "pending" | "failed" | "finished";
	saveStates: ReadonlyMap<string, InboxLinkSaveState>;
	justSaved: EmailLinkOrdinal | undefined;
	saveUrl: string;
	returnTo: string;
	inboxHref: string;
}

type IssueLinksState = "extracting" | "failed" | "ready";

type IssueLinkSaveState = "unsaved" | InboxLinkSaveState;

const SAVE_BUTTON_COPY: Record<IssueLinkSaveState, { label: string; ariaLabelPrefix: string; iconName: string | undefined }> = {
	unsaved: { label: "Save", ariaLabelPrefix: "Save", iconName: undefined },
	saved: { label: "Save again", ariaLabelPrefix: "Saved, save again", iconName: "check" },
	failed: { label: "Try again", ariaLabelPrefix: "Couldn't save, try again", iconName: undefined },
};

const LEDES: Record<IssueLinksState, string> = {
	extracting: "Still finding the links in this issue. Reload in a moment to see them.",
	failed: "Couldn't read the links in this issue.",
	ready: "Save the ones worth reading. The rest stay with the email.",
};

const EMPTY_LEDE = "This issue has no links to articles.";

interface IssueLinkRow {
	ordinal: string;
	href: string;
	title: string;
	host: string;
	saveState: IssueLinkSaveState;
	label: string;
	ariaLabel: string;
	iconName: string | undefined;
}

function rowOf(link: InboxEmailLinkEntry, input: IssueLinksSectionInput): IssueLinkRow {
	const href = link.resolvedUrl ?? link.url;
	const crawledTitle = link.title ?? "";
	const title = crawledTitle === "" ? href : crawledTitle;
	const saveState = link.ordinal === input.justSaved ? "saved" : (input.saveStates.get(link.url) ?? "unsaved");
	const copy = SAVE_BUTTON_COPY[saveState];
	return {
		ordinal: link.ordinal,
		href,
		title,
		host: new URL(href).hostname,
		saveState,
		label: copy.label,
		ariaLabel: `${copy.ariaLabelPrefix}: ${title}`,
		iconName: copy.iconName,
	};
}

const EXTRACTION_STATES: Record<IssueLinksSectionInput["extraction"], IssueLinksState> = {
	pending: "extracting",
	failed: "failed",
	finished: "ready",
};

export function renderIssueLinksSection(input: IssueLinksSectionInput | undefined): string {
	if (input === undefined) {
		return render(ISSUE_LINKS_TEMPLATE, { state: "absent", stateClass: "issue-links--hidden", visible: false });
	}
	const state = EXTRACTION_STATES[input.extraction];
	const rows = input.links
		.filter((link) => !isExcludedLink(link) && validateSaveableUrl(link.url).status === "SUCCESS")
		.map((link) => rowOf(link, input));
	return render(ISSUE_LINKS_TEMPLATE, {
		state,
		stateClass: "issue-links--visible",
		visible: true,
		lede: state === "ready" && rows.length === 0 ? EMPTY_LEDE : LEDES[state],
		rows,
		saveUrl: input.saveUrl,
		returnTo: input.returnTo,
		inboxHref: input.inboxHref,
	});
}
