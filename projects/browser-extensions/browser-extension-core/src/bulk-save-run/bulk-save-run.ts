import "../zod-config";
import { assert } from "../invariant";
import { z } from "zod";
import { bulkSaveNotification } from "../bulk-save-notification";
import { type BulkSaveJobId, BulkSaveJobIdSchema } from "../bulk-save-queue/bulk-save-job";
import type { QueueEvent } from "../bulk-save-queue/bulk-save-queue";
import { WindowIdSchema } from "../domain/window-id";
import type { SaveableTab } from "../popup/save-all-tabs";
import type { BulkSaveResult } from "../reading-list/reading-list.types";

export const BULK_SAVE_RUNS_KEY = "hutch_bulk_save_runs";

export const BulkSaveRunIdSchema = z.uuid().brand<"BulkSaveRunId">();

export type BulkSaveRunId = z.infer<typeof BulkSaveRunIdSchema>;

const RunLinkFields = {
	url: z.string(),
	jobId: BulkSaveJobIdSchema.nullable(),
	tooBigMb: z.number().nullable(),
};

const RunLinkSchema = z.union([
	z.object({
		...RunLinkFields,
		state: z.enum(["capturing", "waiting", "sending", "saved", "already-saved", "queued", "retrying"]),
	}),
	z.object({ ...RunLinkFields, state: z.literal("skipped"), code: z.string(), message: z.string().nullable() }),
	z.object({ ...RunLinkFields, state: z.literal("failed"), unauthorized: z.boolean() }),
]);

export type RunLink = z.infer<typeof RunLinkSchema>;

export const ClientSkipSchema = z.object({ tabId: z.number().int().nullable(), reason: z.string() });

type ClientSkip = z.infer<typeof ClientSkipSchema>;

export const BulkSaveRunSchema = z.object({
	id: BulkSaveRunIdSchema,
	windowId: WindowIdSchema,
	joinedIds: z.array(BulkSaveRunIdSchema),
	epoch: z.number().int().nonnegative(),
	revision: z.number().int().nonnegative(),
	phase: z.enum(["running", "finished"]),
	links: z.array(RunLinkSchema),
	clientSkips: z.array(ClientSkipSchema),
	notified: z.boolean(),
	outcomeSeen: z.boolean(),
});

export type BulkSaveRun = z.infer<typeof BulkSaveRunSchema>;

export function parseBulkSaveRuns(raw: unknown): BulkSaveRun[] {
	const stored = z.array(z.unknown()).safeParse(raw);
	if (!stored.success) return [];
	return stored.data.flatMap((entry) => {
		const run = BulkSaveRunSchema.safeParse(entry);
		return run.success ? [run.data] : [];
	});
}

export type LinkEvent =
	| QueueEvent
	| { kind: "captured"; url: string }
	| { kind: "saved-individually"; url: string }
	| { kind: "admitted"; url: string; jobId: BulkSaveJobId }
	| { kind: "adopted"; supersededJobId: BulkSaveJobId; jobId: BulkSaveJobId }
	| { kind: "unauthorized" };

type LinkState = RunLink["state"];

function isIn(link: RunLink, states: readonly LinkState[]): boolean {
	return states.includes(link.state);
}

function base(link: RunLink): Pick<RunLink, "url" | "jobId" | "tooBigMb"> {
	return { url: link.url, jobId: link.jobId, tooBigMb: link.tooBigMb };
}

const UNANSWERED: readonly LinkState[] = ["waiting", "sending", "retrying"];

const QUEUE_MOVES: { [K in QueueEvent["kind"]]: (link: RunLink, event: Extract<QueueEvent, { kind: K }>) => RunLink } = {
	sending: (link, event) =>
		link.state === "waiting"
			? { ...base(link), state: "sending", tooBigMb: event.tooBigMb ?? link.tooBigMb }
			: link,
	settled: (link, event) =>
		isIn(link, ["sending", "retrying"])
			? { ...base(link), ...event.outcome, tooBigMb: event.tooBigMb ?? link.tooBigMb }
			: link,
	retrying: (link) => (isIn(link, UNANSWERED) ? { ...base(link), state: "retrying" } : link),
	failed: (link, event) =>
		isIn(link, UNANSWERED) ? { ...base(link), state: "failed", unauthorized: event.unauthorized } : link,
};

function moveLink(link: RunLink, event: LinkEvent): RunLink {
	switch (event.kind) {
		case "captured":
			return link.url === event.url && link.state === "capturing" ? { ...base(link), state: "waiting" } : link;
		case "saved-individually":
			return link.url === event.url && isIn(link, ["capturing", "waiting", "sending", "retrying", "failed"])
				? { ...base(link), state: "saved" }
				: link;
		case "admitted":
			return link.url === event.url && link.state === "waiting" && link.jobId === null
				? { ...link, jobId: event.jobId }
				: link;
		case "adopted":
			return link.state === "retrying" && link.jobId === event.supersededJobId ? { ...link, jobId: event.jobId } : link;
		case "unauthorized":
			return link.state === "capturing" || (link.state === "waiting" && link.jobId === null)
				? { ...base(link), state: "failed", unauthorized: true }
				: link;
		case "sending":
			return link.jobId === event.jobId ? QUEUE_MOVES.sending(link, event) : link;
		case "settled":
			return link.jobId === event.jobId ? QUEUE_MOVES.settled(link, event) : link;
		case "retrying":
			return link.jobId === event.jobId ? QUEUE_MOVES.retrying(link, event) : link;
		case "failed":
			return link.jobId === event.jobId ? QUEUE_MOVES.failed(link, event) : link;
	}
}

export function applyLinkEvents(run: BulkSaveRun, events: readonly LinkEvent[]): BulkSaveRun {
	let changed = false;
	const links = run.links.map((link) => {
		const moved = events.reduce(moveLink, link);
		if (moved !== link) changed = true;
		return moved;
	});
	return changed ? { ...run, links } : run;
}

export function compareRecords(a: Pick<BulkSaveRun, "epoch" | "revision">, b: Pick<BulkSaveRun, "epoch" | "revision">): number {
	return a.epoch === b.epoch ? a.revision - b.revision : a.epoch - b.epoch;
}

export function isActive(run: BulkSaveRun): boolean {
	return run.phase === "running";
}

function dedupeSkips(existing: readonly ClientSkip[], incoming: readonly ClientSkip[]): ClientSkip[] {
	const skips = [...existing];
	for (const skip of incoming) {
		const known = skips.some((held) =>
			skip.tabId === null ? held.tabId === null && held.reason === skip.reason : held.tabId === skip.tabId,
		);
		if (!known) skips.push(skip);
	}
	return skips;
}

function capturingLink(url: string): RunLink {
	return { url, jobId: null, tooBigMb: null, state: "capturing" };
}

export type SaveAllRequest = {
	runId: BulkSaveRunId;
	windowId: BulkSaveRun["windowId"];
	tabs: SaveableTab[];
	skipped: ClientSkip[];
};

export function newRun(request: SaveAllRequest): BulkSaveRun {
	return {
		id: request.runId,
		windowId: request.windowId,
		joinedIds: [],
		epoch: 0,
		revision: 0,
		phase: "running",
		links: request.tabs.map((tab) => capturingLink(tab.url)),
		clientSkips: dedupeSkips([], request.skipped),
		notified: false,
		outcomeSeen: false,
	};
}

export function joinRun(run: BulkSaveRun, request: SaveAllRequest): { run: BulkSaveRun; added: SaveableTab[] } {
	const held = new Set(run.links.map((link) => link.url));
	const added = request.tabs.filter((tab) => !held.has(tab.url));
	return {
		run: {
			...run,
			joinedIds: [...run.joinedIds, request.runId],
			links: [...run.links, ...added.map((tab) => capturingLink(tab.url))],
			clientSkips: dedupeSkips(run.clientSkips, request.skipped),
		},
		added,
	};
}

export type PendingJob = { url: string; jobId: BulkSaveJobId; dueNow: boolean };

const IN_FLIGHT: readonly LinkState[] = ["capturing", "waiting", "sending"];

export function settleOrphanedLinks(run: BulkSaveRun, pendingJobs: readonly PendingJob[]): BulkSaveRun {
	const pending = new Set(pendingJobs.map((job) => job.jobId));
	return {
		...run,
		links: run.links.map((link): RunLink => {
			if (!isIn(link, IN_FLIGHT)) return link;
			if (link.jobId !== null && pending.has(link.jobId)) return { ...base(link), state: "retrying" };
			return { ...base(link), state: "failed", unauthorized: false };
		}),
	};
}

export function reconcileRun(input: { run: BulkSaveRun; pendingJobs: readonly PendingJob[] }): BulkSaveRun {
	return {
		...settleOrphanedLinks(input.run, input.pendingJobs),
		epoch: input.run.epoch + 1,
		revision: 0,
		phase: "finished",
	};
}

export function awaitsDueRetry(run: BulkSaveRun, pendingJobs: readonly PendingJob[]): boolean {
	const due = new Set(pendingJobs.filter((job) => job.dueNow).map((job) => job.jobId));
	return run.links.some((link) => link.state === "retrying" && link.jobId !== null && due.has(link.jobId));
}

export function covers(run: BulkSaveRun, urls: readonly string[]): boolean {
	const held = new Set(run.links.map((link) => link.url));
	return (
		urls.length > 0 &&
		urls.every((url) => held.has(url)) &&
		run.phase === "finished" &&
		!run.outcomeSeen &&
		run.links.every((link) => link.state !== "failed")
	);
}

function linksIn(run: BulkSaveRun, state: LinkState): RunLink[] {
	return run.links.filter((link) => link.state === state);
}

export function resultOf(run: BulkSaveRun): BulkSaveResult {
	const failed = run.links.flatMap((link) => (link.state === "failed" ? [link] : []));
	const skipped = run.links.flatMap((link) => (link.state === "skipped" ? [link] : []));
	return {
		saved: linksIn(run, "saved").length + linksIn(run, "already-saved").length,
		alreadySaved: linksIn(run, "already-saved").length,
		queued: linksIn(run, "queued").length,
		skipped: skipped.length,
		skippedUrls: skipped.map((link) =>
			link.message === null ? { url: link.url, code: link.code } : { url: link.url, code: link.code, message: link.message },
		),
		failed: failed.length,
		failedUrls: failed.map((link) => ({ url: link.url })),
		pendingRetry: linksIn(run, "retrying").length,
		tooBig: run.links.flatMap((link) => (link.tooBigMb === null ? [] : [{ url: link.url, mb: link.tooBigMb }])),
		unauthorized: failed.some((link) => link.unauthorized),
	};
}

export type RunViewKind = "saving" | "login" | "failed" | "finished";

const LANDED: readonly LinkState[] = ["saved", "already-saved", "queued", "skipped"];

export function viewKindOf(run: BulkSaveRun): RunViewKind {
	if (isActive(run)) return "saving";
	const landed = run.links.some((link) => isIn(link, LANDED));
	if (!landed && run.links.some((link) => link.state === "failed" && link.unauthorized)) return "login";
	if (run.links.length > 0 && run.links.every((link) => link.state === "failed")) return "failed";
	return "finished";
}

export function clientSkipReasons(run: BulkSaveRun): string[] {
	return [...new Set(run.clientSkips.map((skip) => skip.reason))];
}

export function tabCountOf(run: BulkSaveRun): number {
	return run.links.length + run.clientSkips.length;
}

const OUTCOME_BY_KIND: Record<Exclude<RunViewKind, "saving">, (run: BulkSaveRun) => Parameters<typeof bulkSaveNotification>[0]["outcome"]> = {
	login: () => ({ ok: false, reason: "not-logged-in" }),
	failed: () => ({ ok: false, reason: "error", error: new Error("Every tab of the run failed") }),
	finished: (run) => ({ ok: true, value: resultOf(run) }),
};

export function notificationOf(run: BulkSaveRun): { title: string; message: string } {
	const kind = viewKindOf(run);
	assert(kind !== "saving", "only a finished run is announced");
	return bulkSaveNotification({
		outcome: OUTCOME_BY_KIND[kind](run),
		tabCount: tabCountOf(run),
		saveableCount: run.links.length,
	});
}
