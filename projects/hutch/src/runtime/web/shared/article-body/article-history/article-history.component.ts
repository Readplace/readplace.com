import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderConfirmPopover } from "@packages/web-shell";
import type { LocalTime } from "@packages/web-shell/local-time.format";
import type { ArticleVersion } from "../../article-reader/article-reader.types";

const ARTICLE_HISTORY_TEMPLATE = readFileSync(
	join(__dirname, "article-history.template.html"),
	"utf-8",
);

/** Owner-only removal controls. Present only on the
 * authenticated owner reader (never the public `/view` or the iOS WKWebView),
 * so a viewer with no removal rights sees no remove forms.
 * `authoredMinuteIds` names the version snapshots this viewer authored. */
export interface ArticleHistoryRemoval {
	authoredMinuteIds: string[];
	removeVersionUrl: string;
}

type ArticleHistoryBadge =
	| { key: "state"; label: "Current"; className: "chip chip--badge chip--accent" }
	| { key: "offline"; label: "Offline"; className: "chip chip--badge chip--accent" };

interface ArticleHistoryRemoveForm {
	url: string;
	minuteId: string;
	describedBy: string;
	popoverId: string;
	panelHtml: string;
}

interface ArticleHistoryRow {
	key: string;
	markerClass:
		| "article-history__marker article-history__marker--current"
		| "article-history__marker article-history__marker--earlier";
	dateId: string;
	date: LocalTime;
	time: LocalTime;
	badges: ArticleHistoryBadge[];
	removeForms: ArticleHistoryRemoveForm[];
}

const CURRENT_BADGE: ArticleHistoryBadge = {
	key: "state",
	label: "Current",
	className: "chip chip--badge chip--accent",
};

const OFFLINE_BADGE: ArticleHistoryBadge = {
	key: "offline",
	label: "Offline",
	className: "chip chip--badge chip--accent",
};

const DELETE_ACTIONS_TEMPLATE = `<form class="confirm-popover__actions confirm-popover__buttons" method="POST" action="{{url}}">
	<input type="hidden" name="versionMinuteId" value="{{minuteId}}">
	<button class="btn btn--neutral" type="button" popovertarget="{{popoverId}}" popovertargetaction="hide" data-test-action="article-version-delete-cancel">Cancel</button>
	<button class="btn btn--primary" type="submit" data-test-action="article-version-delete-confirm">Delete version</button>
</form>`;

function removeFormFor(input: {
	url: string;
	minuteId: string;
	index: number;
	describedBy: string;
}): ArticleHistoryRemoveForm {
	const { url, minuteId, describedBy } = input;
	const popoverId = `article-history-delete-${input.index}`;
	return {
		url,
		minuteId,
		describedBy,
		popoverId,
		panelHtml: renderConfirmPopover({
			id: popoverId,
			key: "article-version-delete",
			subject: minuteId,
			title: "Delete this version?",
			body: "This version will be permanently deleted. The article stays in your readlist.",
			actionsHtml: render(DELETE_ACTIONS_TEMPLATE, { url, minuteId, popoverId }),
		}),
	};
}

export function renderArticleHistory(input: {
	versions: ArticleVersion[];
	removal?: ArticleHistoryRemoval;
}): string {
	if (input.versions.length === 0) return "";
	const { removal } = input;
	const rows: ArticleHistoryRow[] = input.versions.map((version, index) => {
		const dateId = `article-history-date-${index}`;
		const authored = removal?.authoredMinuteIds.includes(version.minuteId) ? [removal] : [];
		return {
			key: index === 0 ? "canonical" : version.minuteId,
			markerClass:
				index === 0
					? "article-history__marker article-history__marker--current"
					: "article-history__marker article-history__marker--earlier",
			dateId,
			date: version.date,
			time: version.time,
			badges: index === 0 ? [CURRENT_BADGE] : [],
			removeForms: authored.map((owner) =>
				removeFormFor({
					url: owner.removeVersionUrl,
					minuteId: version.minuteId,
					index,
					describedBy: dateId,
				}),
			),
		};
	});
	return render(ARTICLE_HISTORY_TEMPLATE, { rows });
}

const UNSET_INSTANT = "";

export function renderOfflineCopyTemplate(): string {
	const offlineRow: ArticleHistoryRow = {
		key: "offline",
		markerClass: "article-history__marker article-history__marker--current",
		dateId: "article-history-date-offline",
		date: { iso: UNSET_INSTANT, label: UNSET_INSTANT, mode: "date" },
		time: { iso: UNSET_INSTANT, label: UNSET_INSTANT, mode: "time" },
		badges: [OFFLINE_BADGE],
		removeForms: [],
	};
	return `<template data-offline-copy-template>${render(ARTICLE_HISTORY_TEMPLATE, { rows: [offlineRow] })}</template>`;
}
