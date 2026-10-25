import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { BulkSaveJobIdSchema } from "../bulk-save-queue/bulk-save-job";
import { WindowIdSchema } from "../domain/window-id";
import { BULK_SAVE_RUNS_KEY, type BulkSaveRun, BulkSaveRunIdSchema, type RunLink, parseBulkSaveRuns } from "./bulk-save-run";
import { initBulkSaveRunRecord } from "./bulk-save-run-record";

const RUN_1 = BulkSaveRunIdSchema.parse("11111111-1111-4111-8111-111111111111");
const RUN_2 = BulkSaveRunIdSchema.parse("22222222-2222-4222-8222-222222222222");
const RUN_3 = BulkSaveRunIdSchema.parse("33333333-3333-4333-8333-333333333333");
const JOINED = BulkSaveRunIdSchema.parse("44444444-4444-4444-8444-444444444444");

function link(url: string, state: "capturing" | "waiting" | "retrying", jobId: string | null = null): RunLink {
	return { url, state, jobId: jobId === null ? null : BulkSaveJobIdSchema.parse(jobId), tooBigMb: null };
}

function run(input: { id: BulkSaveRun["id"]; windowId: number; links?: RunLink[]; joinedIds?: BulkSaveRun["joinedIds"] }): BulkSaveRun {
	return {
		id: input.id,
		windowId: WindowIdSchema.parse(input.windowId),
		joinedIds: input.joinedIds ?? [],
		epoch: 0,
		revision: 0,
		phase: "running",
		links: input.links ?? [],
		clientSkips: [],
		notified: false,
		outcomeSeen: false,
	};
}

type Write = { kind: "set"; value: unknown } | { kind: "remove" };

function createArea() {
	const writes: Write[] = [];
	const held: { stored: Record<string, unknown>; release: (() => void)[]; hold: boolean; fail: boolean } = {
		stored: {},
		release: [],
		hold: false,
		fail: false,
	};
	async function settle(): Promise<void> {
		if (held.hold) await new Promise<void>((resolve) => held.release.push(resolve));
		if (held.fail) throw new Error("storage gone");
	}
	const area = {
		get: async (key: string) => (key in held.stored ? { [key]: held.stored[key] } : {}),
		set: async (items: Record<string, unknown>) => {
			writes.push({ kind: "set", value: items[BULK_SAVE_RUNS_KEY] });
			await settle();
			Object.assign(held.stored, items);
		},
		remove: async (key: string) => {
			writes.push({ kind: "remove" });
			await settle();
			delete held.stored[key];
		},
	};
	return {
		area,
		writes,
		held,
		releaseOne: () => held.release.shift()?.(),
		storedRuns: () => parseBulkSaveRuns(held.stored[BULK_SAVE_RUNS_KEY]),
	};
}

function createRecord() {
	const store = createArea();
	const errors: unknown[] = [];
	const record = initBulkSaveRunRecord({
		area: store.area,
		logger: HutchLogger.from({ ...noopLogger, error: (...args: unknown[]) => errors.push(args) }),
	});
	return { record, errors, ...store };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("initBulkSaveRunRecord", () => {
	it("loads the stored runs and finds them by window and by any id they answer to", async () => {
		const { record, held } = createRecord();
		held.stored[BULK_SAVE_RUNS_KEY] = [
			run({ id: RUN_1, windowId: 1 }),
			run({ id: RUN_2, windowId: 2, joinedIds: [JOINED] }),
			run({ id: RUN_3, windowId: 3 }),
		];

		await record.load();

		expect(record.all().map((held) => held.id)).toEqual([RUN_1, RUN_2, RUN_3]);
		expect(record.ofWindow(WindowIdSchema.parse(2))?.id).toBe(RUN_2);
		expect(record.byRunId(JOINED)?.id).toBe(RUN_2);
		expect(record.byRunId(RUN_3)?.id).toBe(RUN_3);
	});

	it("resolves a set once its write lands, with the snapshot it wrote", async () => {
		const { record, storedRuns } = createRecord();

		const stored = await record.set(run({ id: RUN_1, windowId: 1 }));

		expect(stored.revision).toBe(1);
		expect(storedRuns()).toEqual([stored]);
	});

	it("replaces only the same window's run and leaves the other untouched", async () => {
		const { record, storedRuns } = createRecord();
		const other = await record.set(run({ id: RUN_2, windowId: 2 }));
		await record.set(run({ id: RUN_1, windowId: 1 }));

		const replacement = await record.set(run({ id: RUN_3, windowId: 1 }));

		expect(storedRuns()).toEqual([other, replacement]);
	});

	it("coalesces a burst during one write into a single write carrying every run's latest state", async () => {
		const { record, writes, held, releaseOne } = createRecord();
		held.hold = true;
		const first = record.set(run({ id: RUN_1, windowId: 1, links: [link("https://example.com/a", "capturing")] }));
		await flush();
		const burst = [
			record.set(run({ id: RUN_2, windowId: 2 })),
			record.apply({ runId: RUN_1, update: (held) => ({ ...held, phase: "finished" }) }),
			record.apply({ runId: RUN_2, update: (held) => ({ ...held, notified: true }) }),
		];
		releaseOne();
		await first;
		await flush();
		releaseOne();
		await Promise.all(burst);

		expect(writes).toHaveLength(2);
		const last = writes[1];
		expect(last?.kind === "set" ? parseBulkSaveRuns(last.value).map((held) => [held.id, held.revision, held.phase, held.notified]) : []).toEqual([
			[RUN_1, 2, "finished", false],
			[RUN_2, 2, "running", true],
		]);
	});

	it("logs a failed write and still resolves, and the next write lands", async () => {
		const { record, held, errors, storedRuns } = createRecord();
		held.fail = true;

		await record.set(run({ id: RUN_1, windowId: 1 }));
		held.fail = false;
		const written = await record.apply({ runId: RUN_1, update: (held) => ({ ...held, notified: true }) });

		expect(errors).toHaveLength(1);
		expect(storedRuns()).toEqual([written]);
	});

	it("writes nothing for a run it does not hold", async () => {
		const { record, writes } = createRecord();

		expect(await record.apply({ runId: RUN_1, update: (held) => held })).toBeUndefined();
		await record.applyEvents([{ kind: "captured", url: "https://example.com/a" }]);
		await record.admitted({ runId: RUN_1, jobs: [] });

		expect(writes).toEqual([]);
	});

	it("moves every run's link holding a reported job, and ignores a job no run holds", async () => {
		const { record, writes } = createRecord();
		await record.set(run({ id: RUN_1, windowId: 1, links: [link("https://example.com/a", "retrying", "job-a")] }));
		await record.set(run({ id: RUN_2, windowId: 2, links: [link("https://example.com/a", "retrying", "job-a")] }));
		const jobA = BulkSaveJobIdSchema.parse("job-a");

		await record.applyEvents([{ kind: "settled", jobId: jobA, url: "https://example.com/a", outcome: { state: "saved" }, tooBigMb: null }]);
		await record.applyEvents([{ kind: "retrying", jobId: BulkSaveJobIdSchema.parse("job-unknown"), url: "https://example.com/z" }]);

		expect(record.all().map((held) => held.links[0]?.state)).toEqual(["saved", "saved"]);
		expect(writes).toHaveLength(3);
	});

	it("binds the admitting run's links and moves another run's retrying link onto the fresh job in one write", async () => {
		const { record, writes } = createRecord();
		await record.set(run({ id: RUN_1, windowId: 1, links: [link("https://example.com/a", "retrying", "job-old")] }));
		await record.set(run({ id: RUN_2, windowId: 2, links: [link("https://example.com/a", "waiting")] }));
		const fresh = BulkSaveJobIdSchema.parse("job-fresh");

		await record.admitted({
			runId: RUN_2,
			jobs: [{ url: "https://example.com/a", jobId: fresh, supersededJobIds: [BulkSaveJobIdSchema.parse("job-old")] }],
		});

		expect(record.all().map((held) => [held.links[0]?.state, held.links[0]?.jobId])).toEqual([
			["retrying", fresh],
			["waiting", fresh],
		]);
		expect(writes).toHaveLength(3);
	});

	it("clears every run with a removal that a held write cannot overtake", async () => {
		const { record, writes, held, releaseOne, storedRuns } = createRecord();
		await record.set(run({ id: RUN_1, windowId: 1 }));
		await record.set(run({ id: RUN_2, windowId: 2 }));
		held.hold = true;
		const pending = record.apply({ runId: RUN_1, update: (held) => ({ ...held, notified: true }) });
		await flush();
		void record.apply({ runId: RUN_2, update: (held) => ({ ...held, notified: true }) });

		const clearing = record.clear();
		releaseOne();
		await pending;
		await flush();
		releaseOne();
		await clearing;

		expect(writes.at(-1)).toEqual({ kind: "remove" });
		expect(writes).toHaveLength(4);
		expect(storedRuns()).toEqual([]);
		expect(record.all()).toEqual([]);
	});

	it("starts afresh after a clear", async () => {
		const { record, storedRuns } = createRecord();
		await record.set(run({ id: RUN_1, windowId: 1 }));
		await record.clear();

		const fresh = await record.set(run({ id: RUN_2, windowId: 2 }));

		expect(storedRuns()).toEqual([fresh]);
	});
});
