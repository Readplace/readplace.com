import assert from "node:assert/strict";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { GuardedResult } from "../auth/auth.types";
import { UnauthorizedError } from "../auth/unauthorized-error";
import { type BulkSaveJob, parseBulkSaveJobs } from "../bulk-save-queue/bulk-save-job";
import { type PassReport, initBulkSaveQueue } from "../bulk-save-queue/bulk-save-queue";
import { ReadingListItemIdSchema } from "../domain/reading-list-item-id";
import { WindowIdSchema } from "../domain/window-id";
import type { BulkSavePage, SaveUrlResult, TabContent } from "../reading-list/reading-list.types";
import type { BulkChunkSummary, BulkSaveSession } from "../reading-list/siren-reading-list";
import { BULK_SAVE_RUNS_KEY, type BulkSaveRun, BulkSaveRunIdSchema, parseBulkSaveRuns } from "./bulk-save-run";
import { initBulkSaveRunRecord } from "./bulk-save-run-record";
import { type SaveAllStart, SaveAllMessageSchema } from "./save-all-messages";
import { initSaveAllRuns, settleNotificationOf } from "./save-all-runs";

type Respond = (chunk: BulkSavePage[]) => BulkChunkSummary | Promise<BulkChunkSummary>;

const LIMITS = { maxItems: 20, maxBytes: 4_587_520, requestBudget: 4_702_208 };

function allCreated(chunk: BulkSavePage[]): BulkChunkSummary {
	return {
		saved: chunk.length,
		queued: 0,
		skipped: 0,
		failed: 0,
		tooBig: [],
		skippedUrls: [],
		results: chunk.map((page) => ({ url: page.url, outcome: "created" as const })),
	};
}

type World = { session: Record<string, unknown>; jobs: unknown; buffers: Map<string, ArrayBuffer>; time: number };

function createWorld(): World {
	return { session: {}, jobs: [], buffers: new Map(), time: 1_000 };
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

function createContext(
	world: World,
	options: {
		respond?: Respond;
		openSession?: () => Promise<BulkSaveSession>;
		holdCaptures?: boolean;
		readSession?: () => Promise<Record<string, unknown>>;
	} = {},
) {
	const auth = { loggedIn: true };
	const notifications: { title: string; message: string }[] = [];
	const kept: Promise<unknown>[] = [];
	const chunks: BulkSavePage[][] = [];
	const captured: string[] = [];
	const heldCaptures: { url: string; resolve: (content: TabContent | undefined) => void }[] = [];
	const errors: unknown[] = [];
	const logger = HutchLogger.from({ ...noopLogger, error: (...args: unknown[]) => errors.push(args) });
	const jobs = {
		read: async (): Promise<unknown> => world.jobs,
		write: async (written: BulkSaveJob[]) => {
			world.jobs = written;
		},
	};
	const payloads = {
		putAll: async (items: { id: string; bytes: ArrayBuffer }[]) => {
			for (const item of items) world.buffers.set(item.id, item.bytes);
		},
		getAll: async (ids: string[]) =>
			new Map(ids.flatMap((id) => {
				const bytes = world.buffers.get(id);
				return bytes ? [[id, bytes] as const] : [];
			})),
		removeAll: async (ids: string[]) => {
			for (const id of ids) world.buffers.delete(id);
		},
		clear: async () => {
			world.buffers.clear();
		},
	};
	const record = initBulkSaveRunRecord({
		area: {
			get: options.readSession ?? (async (key: string) => (key in world.session ? { [key]: world.session[key] } : {})),
			set: async (items) => {
				Object.assign(world.session, structuredClone(items));
			},
			remove: async (key) => {
				delete world.session[key];
			},
		},
		logger,
	});
	const respond = options.respond ?? allCreated;
	const queue = initBulkSaveQueue({
		jobs,
		payloads,
		scheduler: { now: () => world.time, wakeAt: async () => {}, cancel: async () => {} },
		openSession:
			options.openSession ??
			(async () => ({
				limits: LIMITS,
				sendChunk: async (pages) => {
					chunks.push(pages);
					return respond(pages);
				},
			})),
		progress: (events) => record.applyEvents(events),
		logger,
	});
	function whenLoggedIn<T>(fn: () => T): GuardedResult<T> {
		return auth.loggedIn ? { ok: true, value: fn() } : { ok: false, reason: "not-logged-in" };
	}
	const runs = initSaveAllRuns({
		record,
		queue,
		whenLoggedIn,
		capture: (tab) => {
			captured.push(tab.url);
			if (!options.holdCaptures) return Promise.resolve(undefined);
			return new Promise((resolve) => heldCaptures.push({ url: tab.url, resolve }));
		},
		notify: (notification) => notifications.push(notification),
		keepAlive: (work) => {
			kept.push(work);
			return work;
		},
		logger,
	});
	async function idle(): Promise<void> {
		for (let round = 0; round < 20; round += 1) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}
	function releaseCapture(url: string, content?: TabContent): void {
		const index = heldCaptures.findIndex((held) => held.url === url);
		const held = heldCaptures[index];
		assert(held, `a capture of ${url} is held`);
		heldCaptures.splice(index, 1);
		held.resolve(content);
	}
	return { runs, record, queue, auth, notifications, kept, chunks, captured, errors, jobs, payloads, idle, releaseCapture };
}

let requestCount = 0;

function request(input: { urls: string[]; windowId?: number; skipped?: SaveAllStart["skipped"] }): SaveAllStart {
	requestCount += 1;
	return {
		type: "save-all-tabs",
		runId: BulkSaveRunIdSchema.parse(`00000000-0000-4000-8000-${String(requestCount).padStart(12, "0")}`),
		windowId: WindowIdSchema.parse(input.windowId ?? 1),
		tabs: input.urls.map((url, index) => ({ url, title: url, tabId: index + 1 })),
		skipped: input.skipped ?? [],
	};
}

function storedRuns(world: World): BulkSaveRun[] {
	return parseBulkSaveRuns(world.session[BULK_SAVE_RUNS_KEY]);
}

function startedRun(reply: Awaited<ReturnType<ReturnType<typeof createContext>["runs"]["answer"]>>): BulkSaveRun {
	assert(reply.ok, "the start was answered with a run");
	return reply.run;
}

function states(run: BulkSaveRun | undefined): string[] {
	return (run?.links ?? []).map((link) => link.state);
}

const A = "https://example.com/a";
const B = "https://example.com/b";
const C = "https://example.com/c";

function failingOnce(): Respond {
	let failed = false;
	return (chunk) => {
		if (!failed) {
			failed = true;
			throw new Error("boom");
		}
		return allCreated(chunk);
	};
}

describe("settleNotificationOf", () => {
	function report(overrides: Partial<PassReport>): PassReport {
		return {
			queued: 0,
			saved: 0,
			skipped: 0,
			failed: 0,
			tooBig: [],
			skippedUrls: [],
			failedUrls: [],
			alreadySaved: 0,
			pendingRetry: 0,
			unauthorized: false,
			terminalUrls: [],
			retriedUrls: [],
			drained: true,
			...overrides,
		};
	}

	it("tells the reader what a pass no run claims did", () => {
		const signedOut = { title: "Not signed in", message: "Sign in to Readplace and run Save all tabs again." };
		expect(settleNotificationOf({ kind: "unauthorized" })).toEqual(signedOut);
		expect(settleNotificationOf({ kind: "pass", report: report({ unauthorized: true }) })).toEqual(signedOut);
		expect(settleNotificationOf({ kind: "pass", report: report({ drained: false }) })).toBeNull();
		expect(settleNotificationOf({ kind: "pass", report: report({ terminalUrls: [A, B, C, "https://example.com/d"] }) })).toEqual({
			title: "Couldn't save some tabs",
			message: `4 tabs couldn't be saved after retrying.\n${A}\n${B}\n${C}`,
		});
		expect(settleNotificationOf({ kind: "pass", report: report({ saved: 2 }) })).toEqual({
			title: "Tabs saved",
			message: "Saved 2 after retrying",
		});
		expect(settleNotificationOf({ kind: "pass", report: report({ saved: 1, pendingRetry: 1 }) })).toEqual({
			title: "Tabs saved",
			message: "Saved 1 after retrying · Retrying 1",
		});
		expect(settleNotificationOf({ kind: "pass", report: report({ pendingRetry: 1 }) })).toBeNull();
	});
});

describe("initSaveAllRuns start", () => {
	it("answers not signed in without recording a run, and says so", async () => {
		const world = createWorld();
		const context = createContext(world);
		context.auth.loggedIn = false;

		const reply = await context.runs.answer(request({ urls: [A], skipped: [{ tabId: 9, reason: "x" }] }));

		expect(reply).toEqual({ ok: false, reason: "not-logged-in" });
		expect(world.session).toEqual({});
		expect(context.notifications).toEqual([{ title: "Not signed in", message: "Sign in to Readplace to save your tabs." }]);
	});

	it("records the run before answering, then drives it to one notification", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });

		const run = startedRun(await context.runs.answer(request({ urls: [A, B], skipped: [{ tabId: 9, reason: "x" }] })));

		expect(storedRuns(world)).toEqual([run]);
		expect(states(run)).toEqual(["capturing", "capturing"]);
		context.releaseCapture(A);
		context.releaseCapture(B);
		await context.idle();
		expect(context.notifications).toEqual([{ title: "Tabs saved", message: "Saved 2 · Skipped 1" }]);
		const [finished] = storedRuns(world);
		expect([finished?.phase, finished?.notified, states(finished)]).toEqual(["finished", true, ["saved", "saved"]]);
	});

	it("sends the bytes each tab's capture produced", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });

		await context.runs.answer(request({ urls: [A, B] }));
		context.releaseCapture(A, { bytes: new ArrayBuffer(3), mediaType: "text/html" });
		context.releaseCapture(B);
		await context.idle();

		expect(context.chunks[0]?.map((page) => [page.url, page.content?.mediaType])).toEqual([
			[A, "text/html"],
			[B, undefined],
		]);
	});

	it("finishes a run with nothing saveable at once", async () => {
		const world = createWorld();
		const context = createContext(world);

		await context.runs.answer(request({ urls: [], skipped: [{ tabId: 1, reason: "x" }] }));
		await context.idle();

		expect(context.notifications).toEqual([{ title: "Tabs saved", message: "Saved 0 · Skipped 1" }]);
		expect(context.chunks).toEqual([]);
	});

	it("runs each window's Save all apart, each notifying once", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });

		const first = startedRun(await context.runs.answer(request({ urls: [A], windowId: 1 })));
		const second = startedRun(await context.runs.answer(request({ urls: [A, B], windowId: 2 })));
		expect(second.id).not.toBe(first.id);
		expect(context.captured).toEqual([A, A, B]);
		context.releaseCapture(A);
		await context.idle();
		context.releaseCapture(A);
		context.releaseCapture(B);
		await context.idle();

		expect(context.notifications).toEqual([
			{ title: "Tabs saved", message: "Saved 1 · Skipped 0" },
			{ title: "Tabs saved", message: "Saved 2 · Skipped 0" },
		]);
		expect(storedRuns(world).map((run) => [run.windowId, run.phase])).toEqual([
			[1, "finished"],
			[2, "finished"],
		]);
	});

	it("joins a same-window Save all into the running run, capturing only what it adds", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });
		const first = startedRun(await context.runs.answer(request({ urls: [A, B] })));
		const joining = request({ urls: [B, C], skipped: [{ tabId: 9, reason: "x" }] });

		const joined = startedRun(await context.runs.answer(joining));
		context.releaseCapture(A);
		context.releaseCapture(B);
		context.releaseCapture(C);
		await context.idle();

		expect(joined.id).toBe(first.id);
		expect(joined.joinedIds).toEqual([joining.runId]);
		expect(joined.links.map((link) => link.url)).toEqual([A, B, C]);
		expect(context.captured).toEqual([A, B, C]);
		expect(context.notifications).toEqual([{ title: "Tabs saved", message: "Saved 3 · Skipped 1" }]);
	});

	it("answers a same-window Save all that adds nothing with the run it joins", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });
		await context.runs.answer(request({ urls: [A] }));
		const joining = request({ urls: [A] });

		const joined = startedRun(await context.runs.answer(joining));

		expect(joined.joinedIds).toEqual([joining.runId]);
		expect(context.captured).toEqual([A]);
	});

	it("sends a tab joined while the run's request is in flight on the drive's next round", async () => {
		const world = createWorld();
		const firstChunk = deferred<void>();
		let call = 0;
		const context = createContext(world, {
			respond: async (chunk) => {
				call += 1;
				if (call === 1) await firstChunk.promise;
				return allCreated(chunk);
			},
		});
		await context.runs.answer(request({ urls: [A] }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(context.chunks).toHaveLength(1);

		await context.runs.answer(request({ urls: [B] }));
		firstChunk.resolve();
		await context.idle();

		expect(context.chunks.map((chunk) => chunk.map((page) => page.url))).toEqual([[A], [B]]);
		expect(context.notifications).toEqual([{ title: "Tabs saved", message: "Saved 2 · Skipped 0" }]);
	});

	it("starts a new run over a finished one the reader has seen, replacing only that window's entry", async () => {
		const world = createWorld();
		const context = createContext(world);
		const first = startedRun(await context.runs.answer(request({ urls: [A] })));
		await context.idle();
		await context.runs.acknowledge(first.id);

		const second = startedRun(await context.runs.answer(request({ urls: [A] })));
		await context.idle();

		expect(second.id).not.toBe(first.id);
		expect(storedRuns(world).map((run) => run.id)).toEqual([second.id]);
		expect(context.notifications).toHaveLength(2);
	});

	it("starts a new run over an unseen one that does not hold every tab asked for", async () => {
		const world = createWorld();
		const context = createContext(world);
		const first = startedRun(await context.runs.answer(request({ urls: [A] })));
		await context.idle();

		const second = startedRun(await context.runs.answer(request({ urls: [A, B] })));

		expect(second.id).not.toBe(first.id);
	});

	it("answers a Save all an unseen, clean outcome already covers with that outcome, once", async () => {
		const world = createWorld();
		const context = createContext(world);
		const first = startedRun(await context.runs.answer(request({ urls: [A, B] })));
		await context.idle();
		const again = request({ urls: [B] });

		const covered = startedRun(await context.runs.answer(again));
		await context.idle();

		expect(covered.id).toBe(first.id);
		expect(covered.phase).toBe("finished");
		expect(covered.joinedIds).toEqual([again.runId]);
		expect(context.captured).toEqual([A, B]);
		expect(context.notifications).toHaveLength(1);
	});

	it("never answers another window's request with a covering outcome", async () => {
		const world = createWorld();
		const context = createContext(world);
		const first = startedRun(await context.runs.answer(request({ urls: [A], windowId: 1 })));
		await context.idle();

		const other = startedRun(await context.runs.answer(request({ urls: [A], windowId: 2 })));

		expect(other.id).not.toBe(first.id);
	});
});

describe("initSaveAllRuns drive", () => {
	it("leaves a tab the reader saved on their own during capture out of the request", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });
		await context.runs.answer(request({ urls: [A, B] }));

		await context.runs.savedIndividually(A);
		context.releaseCapture(A);
		context.releaseCapture(B);
		await context.idle();

		expect(context.chunks.map((chunk) => chunk.map((page) => page.url))).toEqual([[B]]);
		expect(context.notifications).toEqual([{ title: "Tabs saved", message: "Saved 2 · Skipped 0" }]);
	});

	it("fails the run as signed out when the session is gone by the time it sends", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });
		await context.runs.answer(request({ urls: [A] }));

		context.auth.loggedIn = false;
		context.releaseCapture(A);
		await context.idle();

		expect(context.chunks).toEqual([]);
		expect(context.notifications).toEqual([{ title: "Not signed in", message: "Sign in to Readplace to save your tabs." }]);
	});

	it("fails the run as signed out when the server refuses the session", async () => {
		const world = createWorld();
		const context = createContext(world, {
			openSession: async () => {
				throw new UnauthorizedError();
			},
		});

		await context.runs.answer(request({ urls: [A] }));
		await context.idle();

		expect(states(storedRuns(world)[0])).toEqual(["failed"]);
		expect(context.notifications).toEqual([{ title: "Not signed in", message: "Sign in to Readplace to save your tabs." }]);
	});

	it("fails the links nothing will retry when the send breaks", async () => {
		const world = createWorld();
		const context = createContext(world);
		context.payloads.putAll = async () => {
			throw new Error("indexeddb gone");
		};

		await context.runs.answer(request({ urls: [A] }));
		await context.idle();

		expect(context.notifications).toEqual([{ title: "Couldn't save tabs", message: "Something went wrong. Please try again." }]);
		expect(context.errors).toHaveLength(1);
	});

	it("fails the links when the job store is gone too", async () => {
		const world = createWorld();
		const context = createContext(world);
		context.jobs.read = async () => {
			throw new Error("indexeddb gone");
		};

		await context.runs.answer(request({ urls: [A] }));
		await context.idle();

		expect(states(storedRuns(world)[0])).toEqual(["failed"]);
		expect(context.errors).toContainEqual([
			"[save-all-runs] could not read the pending jobs of a failed send",
			new Error("indexeddb gone"),
		]);
	});

	it("finishes with the retrying count, then a later pass announces what it saved", async () => {
		const world = createWorld();
		const context = createContext(world, { respond: failingOnce() });

		await context.runs.answer(request({ urls: [A, B] }));
		await context.idle();
		world.time += 60_000;
		await context.runs.resumeAll();

		expect(context.notifications).toEqual([
			{ title: "Tabs saved", message: "Saved 0 · Skipped 0 · Retrying 2" },
			{ title: "Tabs saved", message: "Saved 2 after retrying" },
		]);
		expect(states(storedRuns(world)[0])).toEqual(["saved", "saved"]);
	});

	it("resolves another window's retrying link through the fresh job that supersedes it", async () => {
		const world = createWorld();
		const context = createContext(world, { respond: failingOnce() });
		await context.runs.answer(request({ urls: [A], windowId: 1 }));
		await context.idle();

		await context.runs.answer(request({ urls: [A], windowId: 2 }));
		await context.idle();

		expect(storedRuns(world).map((run) => states(run))).toEqual([["saved"], ["saved"]]);
		expect(parseBulkSaveJobs(world.jobs)).toEqual([]);
	});
});

describe("initSaveAllRuns follow and acknowledge", () => {
	it("holds a follow until the run finishes, matching a joined id too", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });
		const first = startedRun(await context.runs.answer(request({ urls: [A] })));
		const joining = request({ urls: [A] });
		await context.runs.answer(joining);

		const following = [context.runs.follow(first.id), context.runs.follow(joining.runId)];
		context.releaseCapture(A);
		await context.idle();
		const replies = await Promise.all(following);

		expect(replies.map((reply) => (reply.ok ? reply.run?.phase : null))).toEqual(["finished", "finished"]);
	});

	it("answers a finished run at once and an unknown one with nothing", async () => {
		const world = createWorld();
		const context = createContext(world);
		const run = startedRun(await context.runs.answer(request({ urls: [A] })));
		await context.idle();

		expect(await context.runs.follow(run.id)).toEqual({ ok: true, run: storedRuns(world)[0] });
		expect(await context.runs.follow(BulkSaveRunIdSchema.parse("99999999-9999-4999-8999-999999999999"))).toEqual({
			ok: true,
			run: null,
		});
	});

	it("marks only a finished run's outcome seen", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });
		const run = startedRun(await context.runs.answer(request({ urls: [A] })));

		expect(await context.runs.acknowledge(run.id)).toEqual({ ok: true });
		expect(storedRuns(world)[0]?.outcomeSeen).toBe(false);
		context.releaseCapture(A);
		await context.idle();
		await context.runs.acknowledge(run.id);

		expect(storedRuns(world)[0]?.outcomeSeen).toBe(true);
	});

	it("dispatches each save-all message to its handler", async () => {
		const world = createWorld();
		const context = createContext(world);
		const start = request({ urls: [A] });

		const started = await context.runs.handle(SaveAllMessageSchema.parse(start));
		await context.idle();
		const followed = await context.runs.handle(SaveAllMessageSchema.parse({ type: "follow-save-all", runId: start.runId }));
		const acknowledged = await context.runs.handle(SaveAllMessageSchema.parse({ type: "acknowledge-save-all", runId: start.runId }));

		expect([started.ok, followed.ok, acknowledged]).toEqual([true, true, { ok: true }]);
	});
});

describe("initSaveAllRuns after a restart", () => {
	async function orphanedRun(options: { respond?: Respond; urls: string[]; windowId?: number; world?: World }) {
		const world = options.world ?? createWorld();
		const dying = createContext(world, { respond: options.respond, holdCaptures: true });
		const run = startedRun(await dying.runs.answer(request({ urls: options.urls, windowId: options.windowId })));
		return { world, run, dying };
	}

	it("fails and announces a run whose captures died with the worker", async () => {
		const { world, run } = await orphanedRun({ urls: [A] });
		const context = createContext(world);

		await context.runs.resumeAll();

		expect(storedRuns(world).map((held) => [held.id, held.epoch, held.phase, held.notified, states(held)])).toEqual([
			[run.id, 1, "finished", true, ["failed"]],
		]);
		expect(context.notifications).toEqual([{ title: "Couldn't save tabs", message: "Something went wrong. Please try again." }]);
	});

	it("announces a run whose retry is due only once the pass that sends it ends", async () => {
		const world = createWorld();
		const dying = createContext(world, { respond: failingOnce() });
		await dying.runs.answer(request({ urls: [A] }));
		await dying.idle();
		const [settled] = storedRuns(world);
		assert(settled, "the run was recorded");
		world.session[BULK_SAVE_RUNS_KEY] = [{ ...settled, phase: "running", notified: false, links: settled.links.map((link) => ({ ...link, state: "sending" })) }];
		world.time += 60_000;
		const context = createContext(world);

		await context.runs.reconcile();
		expect(context.notifications).toEqual([]);
		await Promise.all([context.runs.resumeAll(), context.runs.resumeAll()]);

		expect(context.notifications).toEqual([{ title: "Tabs saved", message: "Saved 1 · Skipped 0" }]);
		expect(storedRuns(world)[0]?.notified).toBe(true);
	});

	it("announces a finished run the dead worker never announced", async () => {
		const world = createWorld();
		const dying = createContext(world);
		await dying.runs.answer(request({ urls: [A] }));
		await dying.idle();
		const [finished] = storedRuns(world);
		world.session[BULK_SAVE_RUNS_KEY] = [{ ...finished, notified: false }];
		const context = createContext(world);

		const followed = await context.runs.follow(BulkSaveRunIdSchema.parse(finished?.id));

		expect(followed.ok && followed.run?.epoch).toBe(1);
		expect(context.notifications).toEqual([{ title: "Tabs saved", message: "Saved 1 · Skipped 0" }]);
	});

	it("announces a pass no run claims from what the pass did", async () => {
		const world = createWorld();
		const dying = createContext(world, { respond: failingOnce() });
		await dying.runs.answer(request({ urls: [A] }));
		await dying.idle();
		delete world.session[BULK_SAVE_RUNS_KEY];
		world.time += 60_000;
		const context = createContext(world);

		await context.runs.resumeAll();

		expect(context.notifications).toEqual([{ title: "Tabs saved", message: "Saved 1 after retrying" }]);
	});

	it("stays quiet on a pass that sends nothing", async () => {
		const context = createContext(createWorld());

		await context.runs.resumeAll();

		expect(context.notifications).toEqual([]);
	});

	it("logs and carries on when the stored runs cannot be read", async () => {
		const context = createContext(createWorld(), {
			readSession: async () => {
				throw new Error("session storage gone");
			},
		});

		await expect(context.runs.reconcile()).resolves.toBeUndefined();
		expect(context.errors).toHaveLength(1);
	});
});

describe("initSaveAllRuns forget", () => {
	it("stops a drive whose captures settle after sign-out began, answering its follower once", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });
		const run = startedRun(await context.runs.answer(request({ urls: [A] })));
		const following = context.runs.follow(run.id);

		const forgetting = context.runs.forget();
		context.releaseCapture(A);
		await forgetting;
		await context.idle();

		expect(context.chunks).toEqual([]);
		expect(await following).toEqual({ ok: true, run: expect.objectContaining({ phase: "finished" }) });
		expect(context.notifications).toEqual([{ title: "Not signed in", message: "Sign in to Readplace to save your tabs." }]);
		expect(world.session).toEqual({});
	});

	it("lets a pass already sending settle, then fails what is left as signed out", async () => {
		const world = createWorld();
		const firstChunk = deferred<void>();
		let call = 0;
		const context = createContext(world, {
			respond: async (chunk) => {
				call += 1;
				if (call === 1) {
					await firstChunk.promise;
					return allCreated(chunk);
				}
				throw new Error("boom");
			},
		});
		const urls = Array.from({ length: 21 }, (_v, index) => `https://example.com/${index}`);
		await context.runs.answer(request({ urls }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		const forgetting = context.runs.forget();
		firstChunk.resolve();
		await forgetting;
		await context.idle();

		expect(context.notifications).toEqual([
			{ title: "Not signed in", message: "Saved 20 · Skipped 0 · Failed 1\nSign in to Readplace to save the rest." },
		]);
		expect(parseBulkSaveJobs(world.jobs)).toEqual([]);
		expect(world.session).toEqual({});
	});

	it("starts a fresh run for the same tabs once signed out", async () => {
		const world = createWorld();
		const context = createContext(world);
		const first = startedRun(await context.runs.answer(request({ urls: [A] })));
		await context.idle();
		await context.runs.forget();

		const second = startedRun(await context.runs.answer(request({ urls: [A] })));

		expect(second.id).not.toBe(first.id);
	});

	it("claims a deferred run so the pass in flight does not announce it again", async () => {
		const world = createWorld();
		const dying = createContext(world, { respond: failingOnce() });
		await dying.runs.answer(request({ urls: [A] }));
		await dying.idle();
		const [settled] = storedRuns(world);
		world.session[BULK_SAVE_RUNS_KEY] = [{ ...settled, notified: false }];
		world.time += 60_000;
		const context = createContext(world);
		await context.runs.reconcile();

		await context.runs.forget();
		await context.runs.resumeAll();

		expect(context.notifications).toEqual([{ title: "Not signed in", message: "Sign in to Readplace to save your tabs." }]);
	});

	it("clears both windows' runs", async () => {
		const world = createWorld();
		const context = createContext(world, { holdCaptures: true });
		await context.runs.answer(request({ urls: [A], windowId: 1 }));
		await context.runs.answer(request({ urls: [B], windowId: 2 }));

		await context.runs.forget();

		expect(context.notifications).toHaveLength(2);
		expect(world.session).toEqual({});
	});
});

describe("initSaveAllRuns individual saves", () => {
	it("settles a link mid-request as saved and withdraws the retry its chunk would leave", async () => {
		const world = createWorld();
		const chunk = deferred<void>();
		const context = createContext(world, {
			respond: async () => {
				await chunk.promise;
				throw new Error("boom");
			},
		});
		await context.runs.answer(request({ urls: [A] }));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(states(storedRuns(world)[0])).toEqual(["sending"]);

		const settling = context.runs.savedIndividually(A);
		chunk.resolve();
		await settling;
		await context.idle();

		expect(states(storedRuns(world)[0])).toEqual(["saved"]);
		expect(parseBulkSaveJobs(world.jobs)).toEqual([]);
		expect(context.notifications).toEqual([{ title: "Tabs saved", message: "Saved 1 · Skipped 0" }]);
	});

	it("marks the link saved in every window's run that holds it", async () => {
		const world = createWorld();
		const context = createContext(world, { respond: () => {
			throw new Error("boom");
		} });
		await context.runs.answer(request({ urls: [A], windowId: 1 }));
		await context.idle();
		await context.runs.answer(request({ urls: [A, B], windowId: 2 }));
		await context.idle();

		await context.runs.savedIndividually(A);

		expect(storedRuns(world).map((run) => states(run))).toEqual([["saved"], ["saved", "retrying"]]);
		expect(parseBulkSaveJobs(world.jobs).map((job) => job.url)).toEqual([B]);
	});

	it("settles the runs only after a save that landed, handing the result back untouched", async () => {
		const world = createWorld();
		const context = createContext(world, { respond: () => {
			throw new Error("boom");
		} });
		await context.runs.answer(request({ urls: [A, B] }));
		await context.idle();
		const landed: SaveUrlResult = { ok: false, reason: "already-saved" };
		let answer: SaveUrlResult = landed;
		const saveUrl = context.runs.saveUrlSettlingRun(async () => answer);

		expect(await saveUrl({ url: A, title: "A" })).toBe(landed);
		await context.idle();
		expect(states(storedRuns(world)[0])).toEqual(["retrying", "retrying"]);
		answer = {
			ok: true,
			item: { id: ReadingListItemIdSchema.parse("x"), url: B, title: "B", links: [], actions: [], savedAt: new Date(0), needsBrowserCapture: false },
			messages: [],
		};
		expect(await saveUrl({ url: B, title: "B" })).toBe(answer);
		await context.idle();

		expect(states(storedRuns(world)[0])).toEqual(["retrying", "saved"]);
		expect(context.kept).toHaveLength(2);
	});
});

describe("initSaveAllRuns across a worker that dies mid-pass", () => {
	const never = () => new Promise<BulkChunkSummary>(() => {});

	it("retries what the dead pass left queued and announces the run once across both contexts", async () => {
		const world = createWorld();
		let call = 0;
		const dying = createContext(world, {
			respond: (chunk) => {
				call += 1;
				return call === 1 ? allCreated(chunk) : never();
			},
		});
		const urls = Array.from({ length: 21 }, (_v, index) => `https://example.com/${index}`);
		const run = startedRun(await dying.runs.answer(request({ urls })));
		await dying.idle();
		await dying.runs.answer(request({ urls: [C] }));
		const reborn = createContext(world, { holdCaptures: true });

		await reborn.runs.reconcile();
		const reconciled = storedRuns(world)[0];
		expect([reconciled?.epoch, reconciled?.notified]).toEqual([1, false]);
		expect(states(reconciled).slice(19)).toEqual(["saved", "retrying", "failed"]);
		await reborn.runs.resumeAll();

		expect([...dying.notifications, ...reborn.notifications]).toEqual([
			{ title: "Tabs saved", message: "Saved 21 · Skipped 0 · Failed 1" },
		]);
		expect(await reborn.runs.follow(run.id)).toEqual({ ok: true, run: storedRuns(world)[0] });
	});

	it("announces a window whose captures died at once and a window mid-pass after the pass, once each", async () => {
		const world = createWorld();
		const dying = createContext(world, { respond: never, holdCaptures: true });
		const sending = startedRun(await dying.runs.answer(request({ urls: [A], windowId: 1 })));
		dying.releaseCapture(A);
		await dying.idle();
		const capturing = startedRun(await dying.runs.answer(request({ urls: [B], windowId: 2 })));
		const reborn = createContext(world);

		await reborn.runs.reconcile();
		expect(reborn.notifications).toEqual([{ title: "Couldn't save tabs", message: "Something went wrong. Please try again." }]);
		await Promise.all([reborn.runs.resumeAll(), reborn.runs.resumeAll()]);

		expect(reborn.notifications).toEqual([
			{ title: "Couldn't save tabs", message: "Something went wrong. Please try again." },
			{ title: "Tabs saved", message: "Saved 1 · Skipped 0" },
		]);
		expect(storedRuns(world).map((held) => [held.id, held.epoch, states(held)])).toEqual([
			[sending.id, 1, ["saved"]],
			[capturing.id, 1, ["failed"]],
		]);
		const replies = await Promise.all([reborn.runs.follow(sending.id), reborn.runs.follow(capturing.id)]);
		expect(replies.map((reply) => reply.ok && reply.run?.id)).toEqual([sending.id, capturing.id]);
	});
});
