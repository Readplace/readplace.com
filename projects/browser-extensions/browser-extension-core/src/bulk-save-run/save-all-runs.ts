import { assert } from "../invariant";
import type { HutchLogger } from "@packages/hutch-logger";
import type { WhenLoggedIn } from "../auth/auth.types";
import { UnauthorizedError } from "../auth/unauthorized-error";
import { bulkSaveNotification } from "../bulk-save-notification";
import type { BulkSaveQueue, ResumeOutcome } from "../bulk-save-queue/bulk-save-queue";
import type { SaveableTab } from "../popup/save-all-tabs";
import type { BulkSavePage, SaveUrl, TabContent } from "../reading-list/reading-list.types";
import {
	type BulkSaveRun,
	type BulkSaveRunId,
	applyLinkEvents,
	awaitsDueRetry,
	covers,
	isActive,
	joinRun,
	newRun,
	notificationOf,
	reconcileRun,
	settleOrphanedLinks,
} from "./bulk-save-run";
import type { BulkSaveRunRecord } from "./bulk-save-run-record";
import type {
	AcknowledgeSaveAllReply,
	FollowSaveAllReply,
	SaveAllMessage,
	SaveAllReply,
	SaveAllStart,
	SaveAllStartReply,
} from "./save-all-messages";

type Notification = { title: string; message: string };

const SIGNED_OUT_SETTLE: Notification = {
	title: "Not signed in",
	message: "Sign in to Readplace and run Save all tabs again.",
};

export function settleNotificationOf(outcome: ResumeOutcome): Notification | null {
	if (outcome.kind === "unauthorized") return SIGNED_OUT_SETTLE;
	const report = outcome.report;
	if (report.unauthorized) return SIGNED_OUT_SETTLE;
	if (!report.drained) return null;
	if (report.terminalUrls.length > 0) {
		const listed = report.terminalUrls.slice(0, 3).join("\n");
		return {
			title: "Couldn't save some tabs",
			message: `${report.terminalUrls.length} tabs couldn't be saved after retrying.\n${listed}`,
		};
	}
	if (report.saved > 0) {
		let message = `Saved ${report.saved} after retrying`;
		if (report.pendingRetry > 0) message += ` · Retrying ${report.pendingRetry}`;
		return { title: "Tabs saved", message };
	}
	return null;
}

type Captures = { pending: Set<Promise<void>>; pages: Map<string, BulkSavePage> };

export function initSaveAllRuns(deps: {
	record: BulkSaveRunRecord;
	queue: BulkSaveQueue;
	whenLoggedIn: WhenLoggedIn;
	capture: (tab: SaveableTab) => Promise<TabContent | undefined>;
	notify: (notification: Notification) => void;
	keepAlive: <T>(work: Promise<T>) => Promise<T>;
	logger: HutchLogger;
}) {
	const { record, queue, logger } = deps;
	const captures = new Map<BulkSaveRunId, Captures>();
	const waiters = new Map<BulkSaveRunId, ((run: BulkSaveRun) => void)[]>();
	let reconciling: Promise<void> | undefined;
	let resuming: Promise<void> | undefined;

	function loggedIn(): boolean {
		return deps.whenLoggedIn(() => true).ok;
	}

	function answerWaiters(run: BulkSaveRun): void {
		const held = waiters.get(run.id) ?? [];
		waiters.delete(run.id);
		for (const resolve of held) resolve(run);
	}

	async function reconcileOnce(): Promise<void> {
		try {
			await record.load();
		} catch (error) {
			reconciling = undefined;
			logger.error("[save-all-runs] could not load the stored runs", error);
			return;
		}
		try {
			const pendingJobs = await queue.pendingJobs();
			for (const stored of record.all().filter((run) => !run.notified)) {
				const reconciled = reconcileRun({ run: stored, pendingJobs });
				const deferred = awaitsDueRetry(reconciled, pendingJobs);
				const written = await record.set({ ...reconciled, notified: !deferred });
				if (!deferred) deps.notify(notificationOf(written));
			}
		} catch (error) {
			logger.error("[save-all-runs] could not reconcile the stored runs", error);
		}
	}

	function reconcile(): Promise<void> {
		reconciling ??= reconcileOnce();
		return reconciling;
	}

	function startCaptures(input: { runId: BulkSaveRunId; pool: Captures; tabs: readonly SaveableTab[] }): void {
		for (const tab of input.tabs) {
			const settled: Promise<void> = deps.capture(tab).then(async (content) => {
				const page: BulkSavePage = { url: tab.url, title: tab.title };
				if (content) page.content = content;
				input.pool.pages.set(tab.url, page);
				input.pool.pending.delete(settled);
				await record.apply({
					runId: input.runId,
					update: (run) => applyLinkEvents(run, [{ kind: "captured", url: tab.url }]),
				});
			});
			input.pool.pending.add(settled);
		}
	}

	async function capturesSettled(pool: Captures): Promise<void> {
		while (pool.pending.size > 0) await Promise.all(pool.pending);
	}

	function stillRunning(runId: BulkSaveRunId): BulkSaveRun | undefined {
		const run = record.byRunId(runId);
		return run && isActive(run) ? run : undefined;
	}

	function unsent(run: BulkSaveRun): boolean {
		return run.links.some((link) => link.state === "capturing" || (link.state === "waiting" && link.jobId === null));
	}

	async function finish(run: BulkSaveRun): Promise<void> {
		const finished = await record.apply({
			runId: run.id,
			update: (held) => ({ ...held, phase: "finished", notified: true }),
		});
		assert(finished, "a run still running when its drive finishes it is in the record");
		deps.notify(notificationOf(finished));
		answerWaiters(finished);
	}

	async function send(runId: BulkSaveRunId, pool: Captures, run: BulkSaveRun): Promise<"sent" | "stopped"> {
		const pages = run.links
			.filter((link) => link.state === "waiting" && link.jobId === null)
			.map((link) => {
				const page = pool.pages.get(link.url);
				assert(page, "a link waits only once its capture is in the pool");
				return page;
			});
		const guarded = deps.whenLoggedIn(() =>
			queue.savePages({ pages, admitted: (jobs) => record.admitted({ runId, jobs }) }),
		);
		if (!guarded.ok) {
			await record.apply({ runId, update: (held) => applyLinkEvents(held, [{ kind: "unauthorized" }]) });
			return "stopped";
		}
		try {
			await guarded.value;
			return "sent";
		} catch (error) {
			if (error instanceof UnauthorizedError) {
				await record.apply({ runId, update: (held) => applyLinkEvents(held, [{ kind: "unauthorized" }]) });
				return "stopped";
			}
			logger.error("[save-all-runs] the run's send failed", error);
			const pendingJobs = await queue.pendingJobs().catch((readError: unknown) => {
				logger.error("[save-all-runs] could not read the pending jobs of a failed send", readError);
				return [];
			});
			await record.apply({ runId, update: (held) => settleOrphanedLinks(held, pendingJobs) });
			return "stopped";
		}
	}

	async function drive(runId: BulkSaveRunId, pool: Captures): Promise<void> {
		for (;;) {
			await capturesSettled(pool);
			const run = stillRunning(runId);
			if (run === undefined) return;
			const sent = await send(runId, pool, run);
			const after = stillRunning(runId);
			if (after === undefined) return;
			if (sent === "sent" && unsent(after)) continue;
			await finish(after);
			return;
		}
	}

	function startDrive(run: BulkSaveRun, tabs: readonly SaveableTab[]): void {
		const pool: Captures = { pending: new Set(), pages: new Map() };
		captures.set(run.id, pool);
		startCaptures({ runId: run.id, pool, tabs });
		void deps.keepAlive(
			drive(run.id, pool).finally(() => {
				captures.delete(run.id);
			}),
		);
	}

	async function answer(request: SaveAllStart): Promise<SaveAllStartReply> {
		await reconcile();
		if (!loggedIn()) {
			deps.notify(
				bulkSaveNotification({
					outcome: { ok: false, reason: "not-logged-in" },
					tabCount: request.tabs.length + request.skipped.length,
					saveableCount: request.tabs.length,
				}),
			);
			return { ok: false, reason: "not-logged-in" };
		}
		const mine = record.ofWindow(request.windowId);
		if (mine && isActive(mine)) {
			const joined = joinRun(mine, request);
			const pool = captures.get(mine.id);
			assert(pool, "a run still running in this context is being driven by it");
			const storing = record.set(joined.run);
			startCaptures({ runId: mine.id, pool, tabs: joined.added });
			return { ok: true, run: await storing };
		}
		if (mine && covers(mine, request.tabs.map((tab) => tab.url))) {
			return { ok: true, run: await record.set({ ...mine, joinedIds: [...mine.joinedIds, request.runId] }) };
		}
		const stored = await record.set(newRun(request));
		startDrive(stored, request.tabs);
		return { ok: true, run: stored };
	}

	async function follow(runId: BulkSaveRunId): Promise<FollowSaveAllReply> {
		await reconcile();
		const run = record.byRunId(runId);
		if (run === undefined) return { ok: true, run: null };
		if (!isActive(run)) return { ok: true, run };
		return new Promise((resolve) => {
			waiters.set(run.id, [...(waiters.get(run.id) ?? []), (finished) => resolve({ ok: true, run: finished })]);
		});
	}

	async function acknowledge(runId: BulkSaveRunId): Promise<AcknowledgeSaveAllReply> {
		const run = record.byRunId(runId);
		if (run && !isActive(run)) {
			await record.apply({ runId, update: (held) => ({ ...held, outcomeSeen: true }) });
		}
		return { ok: true };
	}

	async function claimUnnotified(): Promise<BulkSaveRun[]> {
		const claimed = record.all().filter((run) => !isActive(run) && !run.notified);
		const written = await Promise.all(
			claimed.map((run) => record.apply({ runId: run.id, update: (held) => ({ ...held, notified: true }) })),
		);
		return written.filter((run): run is BulkSaveRun => run !== undefined);
	}

	async function resumeOnce(): Promise<void> {
		await reconcile();
		const outcome = await queue.resume();
		const claimed = await claimUnnotified();
		for (const run of claimed) deps.notify(notificationOf(run));
		if (claimed.length > 0) return;
		const settled = settleNotificationOf(outcome);
		if (settled) deps.notify(settled);
	}

	function resumeAll(): Promise<void> {
		resuming ??= resumeOnce().finally(() => {
			resuming = undefined;
		});
		return resuming;
	}

	async function forget(): Promise<void> {
		const claimed = record
			.all()
			.filter((run) => isActive(run) || !run.notified)
			.map((run) => run.id);
		const written = claimed.map((runId) =>
			record.apply({
				runId,
				update: (held) => ({
					...applyLinkEvents(held, [{ kind: "unauthorized" }]),
					phase: "finished",
					notified: true,
				}),
			}),
		);
		await Promise.all(written);
		await queue.purge();
		for (const run of record.all().filter((held) => claimed.includes(held.id))) {
			deps.notify(notificationOf(run));
			answerWaiters(run);
		}
		await record.clear();
	}

	async function savedIndividually(url: string): Promise<void> {
		await reconcile();
		await record.applyEvents([{ kind: "saved-individually", url }]);
		await queue.withdraw(url);
	}

	function saveUrlSettlingRun(saveUrl: SaveUrl): SaveUrl {
		return async (params) => {
			const result = await saveUrl(params);
			if (result.ok) void deps.keepAlive(savedIndividually(params.url));
			return result;
		};
	}

	function handle(message: SaveAllMessage): Promise<SaveAllReply> {
		switch (message.type) {
			case "save-all-tabs":
				return answer(message);
			case "follow-save-all":
				return follow(message.runId);
			case "acknowledge-save-all":
				return acknowledge(message.runId);
		}
	}

	return { answer, follow, acknowledge, reconcile, resumeAll, forget, savedIndividually, saveUrlSettlingRun, handle };
}

export type SaveAllRuns = ReturnType<typeof initSaveAllRuns>;
