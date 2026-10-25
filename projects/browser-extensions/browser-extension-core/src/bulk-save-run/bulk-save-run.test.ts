import { BulkSaveJobIdSchema } from "../bulk-save-queue/bulk-save-job";
import { WindowIdSchema } from "../domain/window-id";
import { summarizeBulkSave } from "../popup/save-all-tabs";
import {
	type BulkSaveRun,
	BulkSaveRunIdSchema,
	type RunLink,
	applyLinkEvents,
	awaitsDueRetry,
	clientSkipReasons,
	compareRecords,
	covers,
	isActive,
	joinRun,
	newRun,
	notificationOf,
	parseBulkSaveRuns,
	reconcileRun,
	resultOf,
	tabCountOf,
	viewKindOf,
} from "./bulk-save-run";

const RUN_ID = BulkSaveRunIdSchema.parse("6f1c2a4e-1d1b-4c55-9a77-0d5e3f2b8a10");
const JOIN_ID = BulkSaveRunIdSchema.parse("0b8e5d3c-7a6f-4e21-8c3d-2f1a9b7c6d54");
const WINDOW = WindowIdSchema.parse(1);
const JOB_A = BulkSaveJobIdSchema.parse("job-a");
const JOB_B = BulkSaveJobIdSchema.parse("job-b");

function link(url: string, state: Exclude<RunLink["state"], "skipped" | "failed">, jobId: string | null = null): RunLink {
	return { url, state, jobId: jobId === null ? null : BulkSaveJobIdSchema.parse(jobId), tooBigMb: null };
}

function runWith(links: RunLink[], overrides: Partial<BulkSaveRun> = {}): BulkSaveRun {
	return {
		id: RUN_ID,
		windowId: WINDOW,
		joinedIds: [],
		epoch: 0,
		revision: 1,
		phase: "running",
		links,
		clientSkips: [],
		notified: false,
		outcomeSeen: false,
		...overrides,
	};
}

describe("parseBulkSaveRuns", () => {
	it("keeps the well-formed runs and drops a malformed or windowless entry", () => {
		const good = runWith([link("https://example.com/a", "capturing")]);
		const { windowId: _windowId, ...windowless } = good;

		expect(parseBulkSaveRuns([good, { nonsense: true }, windowless])).toEqual([good]);
	});

	it("reads a stored value that is not a list as no runs", () => {
		expect(parseBulkSaveRuns("not-a-list")).toEqual([]);
	});
});

describe("applyLinkEvents", () => {
	it("moves a captured link to waiting", () => {
		const run = runWith([link("https://example.com/a", "capturing")]);

		expect(applyLinkEvents(run, [{ kind: "captured", url: "https://example.com/a" }]).links).toEqual([
			link("https://example.com/a", "waiting"),
		]);
	});

	it("binds an admitted job to a waiting link once", () => {
		const run = runWith([link("https://example.com/a", "waiting")]);
		const bound = applyLinkEvents(run, [{ kind: "admitted", url: "https://example.com/a", jobId: JOB_A }]);

		expect(bound.links).toEqual([link("https://example.com/a", "waiting", "job-a")]);
		expect(applyLinkEvents(bound, [{ kind: "admitted", url: "https://example.com/a", jobId: JOB_B }])).toBe(bound);
	});

	it("follows a job from sending to its outcome, keeping the size it was sent at", () => {
		const run = runWith([link("https://example.com/a", "waiting", "job-a"), link("https://example.com/b", "waiting", "job-b")]);

		const settled = applyLinkEvents(run, [
			{ kind: "sending", jobId: JOB_A, url: "https://example.com/a", tooBigMb: 7 },
			{ kind: "sending", jobId: JOB_B, url: "https://example.com/b", tooBigMb: null },
			{ kind: "settled", jobId: JOB_A, url: "https://example.com/a", outcome: { state: "saved" }, tooBigMb: null },
			{
				kind: "settled",
				jobId: JOB_B,
				url: "https://example.com/b",
				outcome: { state: "skipped", code: "blocked", message: null },
				tooBigMb: 3,
			},
		]);

		expect(settled.links).toEqual([
			{ url: "https://example.com/a", jobId: JOB_A, tooBigMb: 7, state: "saved" },
			{ url: "https://example.com/b", jobId: JOB_B, tooBigMb: 3, state: "skipped", code: "blocked", message: null },
		]);
	});

	it("retries and then fails a job on the queue's word", () => {
		const run = runWith([link("https://example.com/a", "sending", "job-a")]);

		const retrying = applyLinkEvents(run, [{ kind: "retrying", jobId: JOB_A, url: "https://example.com/a" }]);
		const failed = applyLinkEvents(retrying, [{ kind: "failed", jobId: JOB_A, url: "https://example.com/a", unauthorized: false }]);

		expect(retrying.links).toEqual([link("https://example.com/a", "retrying", "job-a")]);
		expect(failed.links).toEqual([
			{ url: "https://example.com/a", jobId: JOB_A, tooBigMb: null, state: "failed", unauthorized: false },
		]);
	});

	it("ignores a report for a job the link does not hold, or one a link has moved past", () => {
		const run = runWith([
			link("https://example.com/a", "saved", "job-a"),
			link("https://example.com/b", "waiting"),
			link("https://example.com/c", "capturing", "job-c"),
			link("https://example.com/d", "retrying", "job-b"),
		]);

		expect(
			applyLinkEvents(run, [
				{ kind: "retrying", jobId: JOB_A, url: "https://example.com/a" },
				{ kind: "failed", jobId: JOB_A, url: "https://example.com/a", unauthorized: true },
				{ kind: "settled", jobId: JOB_A, url: "https://example.com/a", outcome: { state: "queued" }, tooBigMb: null },
				{ kind: "sending", jobId: JOB_A, url: "https://example.com/b", tooBigMb: null },
				{ kind: "settled", jobId: BulkSaveJobIdSchema.parse("job-c"), url: "https://example.com/c", outcome: { state: "saved" }, tooBigMb: null },
				{ kind: "sending", jobId: JOB_B, url: "https://example.com/d", tooBigMb: null },
				{ kind: "captured", url: "https://example.com/d" },
			]),
		).toBe(run);
	});

	it("keeps an individual save final, so the chunk's later retry is ignored", () => {
		const run = runWith([link("https://example.com/a", "sending", "job-a")]);

		const saved = applyLinkEvents(run, [
			{ kind: "saved-individually", url: "https://example.com/a" },
			{ kind: "retrying", jobId: JOB_A, url: "https://example.com/a" },
		]);

		expect(saved.links).toEqual([link("https://example.com/a", "saved", "job-a")]);
	});

	it("marks every unanswered state saved for an individual save, and leaves a final one alone", () => {
		const run = runWith([
			link("https://example.com/a", "capturing"),
			{ url: "https://example.com/a", jobId: null, tooBigMb: null, state: "failed", unauthorized: false },
			link("https://example.com/a", "already-saved", "job-a"),
		]);

		expect(applyLinkEvents(run, [{ kind: "saved-individually", url: "https://example.com/a" }]).links.map((held) => held.state)).toEqual([
			"saved",
			"saved",
			"already-saved",
		]);
	});

	it("adopts the fresh job of another run's admission only for a retrying link holding the superseded one", () => {
		const run = runWith([
			link("https://example.com/a", "retrying", "job-a"),
			link("https://example.com/b", "retrying", "job-b"),
			link("https://example.com/c", "waiting", "job-a"),
		]);
		const fresh = BulkSaveJobIdSchema.parse("job-fresh");

		expect(applyLinkEvents(run, [{ kind: "adopted", supersededJobId: JOB_A, jobId: fresh }]).links).toEqual([
			link("https://example.com/a", "retrying", "job-fresh"),
			link("https://example.com/b", "retrying", "job-b"),
			link("https://example.com/c", "waiting", "job-a"),
		]);
	});

	it("fails as signed out only the links that hold no job yet", () => {
		const run = runWith([
			link("https://example.com/a", "capturing"),
			link("https://example.com/b", "waiting"),
			link("https://example.com/c", "waiting", "job-a"),
		]);

		expect(applyLinkEvents(run, [{ kind: "unauthorized" }]).links.map((held) => held.state)).toEqual([
			"failed",
			"failed",
			"waiting",
		]);
	});
});

describe("compareRecords", () => {
	it("orders by epoch before revision", () => {
		expect(compareRecords({ epoch: 2, revision: 1 }, { epoch: 1, revision: 9 })).toBeGreaterThan(0);
		expect(compareRecords({ epoch: 1, revision: 3 }, { epoch: 1, revision: 4 })).toBeLessThan(0);
	});
});

describe("newRun and joinRun", () => {
	const tabs = [
		{ url: "https://example.com/a", title: "A", tabId: 1 },
		{ url: "https://example.com/b", title: "B", tabId: 2 },
	];

	it("starts a running run capturing every saveable tab, with each skipped tab once", () => {
		const run = newRun({
			runId: RUN_ID,
			windowId: WINDOW,
			tabs,
			skipped: [
				{ tabId: 9, reason: "Only http and https URLs can be saved" },
				{ tabId: 9, reason: "Only http and https URLs can be saved" },
				{ tabId: null, reason: "Only http and https URLs can be saved" },
				{ tabId: null, reason: "Only http and https URLs can be saved" },
			],
		});

		expect(isActive(run)).toBe(true);
		expect(run.links.map((held) => [held.url, held.state])).toEqual([
			["https://example.com/a", "capturing"],
			["https://example.com/b", "capturing"],
		]);
		expect(run.clientSkips).toEqual([
			{ tabId: 9, reason: "Only http and https URLs can be saved" },
			{ tabId: null, reason: "Only http and https URLs can be saved" },
		]);
	});

	it("joins only the tabs and skips the run lacks, recording the joining id", () => {
		const run = newRun({ runId: RUN_ID, windowId: WINDOW, tabs, skipped: [{ tabId: 9, reason: "x" }] });

		const joined = joinRun(run, {
			runId: JOIN_ID,
			windowId: WINDOW,
			tabs: [...tabs, { url: "https://example.com/c", title: "C", tabId: 3 }],
			skipped: [{ tabId: 9, reason: "x" }, { tabId: 10, reason: "y" }],
		});

		expect(joined.added).toEqual([{ url: "https://example.com/c", title: "C", tabId: 3 }]);
		expect(joined.run.links.map((held) => held.url)).toEqual([
			"https://example.com/a",
			"https://example.com/b",
			"https://example.com/c",
		]);
		expect(joined.run.clientSkips).toEqual([{ tabId: 9, reason: "x" }, { tabId: 10, reason: "y" }]);
		expect(joined.run.joinedIds).toEqual([JOIN_ID]);
	});
});

describe("reconcileRun", () => {
	it("keeps a link retrying only while its own job is queued, and finishes the run in a new epoch", () => {
		const run = runWith(
			[
				link("https://example.com/a", "sending", "job-a"),
				link("https://example.com/b", "waiting", "job-b"),
				link("https://example.com/c", "capturing"),
				link("https://example.com/d", "saved", "job-d"),
			],
			{ epoch: 2, revision: 7 },
		);

		const reconciled = reconcileRun({
			run,
			pendingJobs: [
				{ url: "https://example.com/a", jobId: JOB_A, dueNow: true },
				{ url: "https://example.com/b", jobId: BulkSaveJobIdSchema.parse("job-other"), dueNow: false },
			],
		});

		expect(reconciled.links.map((held) => held.state)).toEqual(["retrying", "failed", "failed", "saved"]);
		expect([reconciled.epoch, reconciled.revision, reconciled.phase]).toEqual([3, 0, "finished"]);
	});

	it("defers the announcement only while a retrying link's job is due now", () => {
		const run = runWith([link("https://example.com/a", "retrying", "job-a"), link("https://example.com/b", "retrying")]);

		expect(awaitsDueRetry(run, [{ url: "https://example.com/a", jobId: JOB_A, dueNow: true }])).toBe(true);
		expect(awaitsDueRetry(run, [{ url: "https://example.com/a", jobId: JOB_A, dueNow: false }])).toBe(false);
	});
});

describe("covers", () => {
	const finished = runWith([link("https://example.com/a", "saved"), link("https://example.com/b", "already-saved")], {
		phase: "finished",
	});

	it("answers a request whose every tab the finished, unseen, clean run holds", () => {
		expect(covers(finished, ["https://example.com/a"])).toBe(true);
	});

	it("leaves an empty request, a new tab, a seen outcome, a failed link or a live run to a new run", () => {
		expect(covers(finished, [])).toBe(false);
		expect(covers(finished, ["https://example.com/new"])).toBe(false);
		expect(covers({ ...finished, outcomeSeen: true }, ["https://example.com/a"])).toBe(false);
		expect(covers({ ...finished, phase: "running" }, ["https://example.com/a"])).toBe(false);
		expect(
			covers(
				{
					...finished,
					links: [{ url: "https://example.com/a", jobId: null, tooBigMb: null, state: "failed", unauthorized: false }],
				},
				["https://example.com/a"],
			),
		).toBe(false);
	});
});

describe("resultOf and the outcome strings", () => {
	it("reads today's summary off the run", () => {
		const run = runWith(
			[
				link("https://example.com/pinned", "already-saved"),
				...Array.from({ length: 6 }, (_v, index) => link(`https://example.com/open-tab-${index}`, "saved")),
				{ url: "https://example.com/open-tab-6", jobId: null, tooBigMb: null, state: "failed", unauthorized: false },
			],
			{
				phase: "finished",
				clientSkips: [
					{ tabId: 9, reason: "Only http and https URLs can be saved" },
					{ tabId: 10, reason: "Readplace's own pages aren't saved" },
				],
			},
		);

		expect(summarizeBulkSave({ result: resultOf(run), tabCount: tabCountOf(run), saveableCount: run.links.length }).summary).toBe(
			"Saved 6 · Already in readlist 1 · Skipped 2 · Failed 1",
		);
		expect(clientSkipReasons(run)).toEqual(["Only http and https URLs can be saved", "Readplace's own pages aren't saved"]);
	});

	it("counts queued, skipped, retrying and oversized links", () => {
		const run = runWith(
			[
				link("https://example.com/q", "queued"),
				{ url: "https://example.com/s", jobId: null, tooBigMb: null, state: "skipped", code: "blocked", message: "Blocked" },
				{ url: "https://example.com/t", jobId: null, tooBigMb: null, state: "skipped", code: "quiet", message: null },
				link("https://example.com/r", "retrying"),
				{ url: "https://example.com/big", jobId: null, tooBigMb: 6, state: "saved" },
			],
			{ phase: "finished" },
		);

		expect(resultOf(run)).toEqual({
			saved: 1,
			alreadySaved: 0,
			queued: 1,
			skipped: 2,
			skippedUrls: [
				{ url: "https://example.com/s", code: "blocked", message: "Blocked" },
				{ url: "https://example.com/t", code: "quiet" },
			],
			failed: 0,
			failedUrls: [],
			pendingRetry: 1,
			tooBig: [{ url: "https://example.com/big", mb: 6 }],
			unauthorized: false,
		});
	});

	it("reads 'Saved 100 · Skipped 1' for the perf run", () => {
		const run = runWith(
			Array.from({ length: 100 }, (_v, index) => link(`https://example.com/${index}`, "saved")),
			{ phase: "finished", clientSkips: [{ tabId: 1, reason: "Only http and https URLs can be saved" }] },
		);

		expect(notificationOf(run)).toEqual({ title: "Tabs saved", message: "Saved 100 · Skipped 1" });
	});
});

describe("viewKindOf and notificationOf", () => {
	const unauthorized: RunLink = { url: "https://example.com/a", jobId: null, tooBigMb: null, state: "failed", unauthorized: true };
	const failed: RunLink = { url: "https://example.com/b", jobId: null, tooBigMb: null, state: "failed", unauthorized: false };

	it("is saving while the run runs", () => {
		expect(viewKindOf(runWith([link("https://example.com/a", "waiting")]))).toBe("saving");
	});

	it("asks to sign in when a 401 cut the run short before anything landed", () => {
		const run = runWith([unauthorized, failed], { phase: "finished" });

		expect(viewKindOf(run)).toBe("login");
		expect(notificationOf(run)).toEqual({ title: "Not signed in", message: "Sign in to Readplace to save your tabs." });
	});

	it("reports the landed part and asks to sign in for the rest", () => {
		const run = runWith([unauthorized, link("https://example.com/c", "saved")], { phase: "finished" });

		expect(viewKindOf(run)).toBe("finished");
		expect(notificationOf(run)).toEqual({
			title: "Not signed in",
			message: "Saved 1 · Skipped 0 · Failed 1\nSign in to Readplace to save the rest.",
		});
	});

	it("fails the run when every link failed", () => {
		const run = runWith([failed], { phase: "finished" });

		expect(viewKindOf(run)).toBe("failed");
		expect(notificationOf(run)).toEqual({ title: "Couldn't save tabs", message: "Something went wrong. Please try again." });
	});

	it("finishes a run with no links as nothing saved", () => {
		const run = runWith([], { phase: "finished", clientSkips: [{ tabId: 1, reason: "x" }] });

		expect(viewKindOf(run)).toBe("finished");
		expect(notificationOf(run)).toEqual({ title: "Tabs saved", message: "Saved 0 · Skipped 1" });
	});

	it("refuses to announce a run still running", () => {
		expect(() => notificationOf(runWith([link("https://example.com/a", "waiting")]))).toThrow();
	});
});
