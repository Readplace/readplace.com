import {
	type BulkSaveRun,
	type RunViewKind,
	clientSkipReasons,
	isActive,
	resultOf,
	tabCountOf,
	viewKindOf,
} from "../bulk-save-run/bulk-save-run";
import type { WindowId } from "../domain/window-id";
import { type SaveAllDetailLine, buildSaveAllDetailLines, savingTabsTitle, summarizeBulkSave } from "./save-all-tabs";

export type SaveAllView = {
	kind: RunViewKind;
	title: string;
	countLine: string;
	ariaBusy: boolean;
	revealPending: boolean;
	summary: string;
	tooBig: string | null;
	detailLines: SaveAllDetailLine[];
	showReadlist: boolean;
};

const ANSWERED = new Set(["saved", "already-saved", "queued", "skipped", "retrying", "failed"]);

function countLineOf(run: BulkSaveRun | null): string {
	if (run === null) return "";
	const total = run.links.length;
	const capturing = run.links.filter((link) => link.state === "capturing").length;
	if (capturing > 0) return `Captured ${total - capturing} of ${total}`;
	const sent = run.links.filter((link) => ANSWERED.has(link.state)).length;
	const sending = run.links.filter((link) => link.state === "sending").length;
	const line = `Sent ${sent} of ${total}`;
	return sending > 0 ? `${line} · Sending ${sending}` : line;
}

function savingView(input: { provisionalCount: number | null; run: BulkSaveRun | null }): SaveAllView {
	const count = input.run === null ? input.provisionalCount : input.run.links.length;
	return {
		kind: "saving",
		title: savingTabsTitle(count ?? 0),
		countLine: countLineOf(input.run),
		ariaBusy: true,
		revealPending: input.run !== null,
		summary: "",
		tooBig: null,
		detailLines: [],
		showReadlist: false,
	};
}

export function buildSaveAllView(input: { provisionalCount: number | null; run: BulkSaveRun | null }): SaveAllView {
	const run = input.run;
	if (run === null || isActive(run)) return savingView(input);
	const result = resultOf(run);
	const { title, summary, tooBig } = summarizeBulkSave({
		result,
		tabCount: tabCountOf(run),
		saveableCount: run.links.length,
	});
	return {
		kind: viewKindOf(run),
		title,
		countLine: "",
		ariaBusy: false,
		revealPending: false,
		summary,
		tooBig,
		detailLines: buildSaveAllDetailLines({ ...result, clientSkipReasons: clientSkipReasons(run) }),
		showReadlist: !result.unauthorized,
	};
}

export function routeToolbarOpen(input: {
	runs: readonly BulkSaveRun[];
	activeTab: { url: string; tabId: number | undefined; windowId: WindowId };
}): { kind: "follow"; run: BulkSaveRun } | { kind: "single-save" } {
	const run = input.runs.find((held) => held.windowId === input.activeTab.windowId);
	if (run === undefined || !isActive(run)) return { kind: "single-save" };
	const holdsUrl = run.links.some((link) => link.url === input.activeTab.url);
	const holdsTab = run.clientSkips.some((skip) => skip.tabId !== null && skip.tabId === input.activeTab.tabId);
	return holdsUrl || holdsTab ? { kind: "follow", run } : { kind: "single-save" };
}
