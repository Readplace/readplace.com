import assert from "node:assert/strict";
import type { SavePhase } from "./save-progress";
import { type Scheduler, initSaveProgressSequencer } from "./save-progress-sequencer";

type FakeClock = {
	scheduler: Scheduler;
	advance: (ms: number) => void;
	pendingTimerCount: () => number;
};

function makeFakeClock(): FakeClock {
	let current = 0;
	let nextId = 0;
	const tasks = new Map<number, { time: number; callback: () => void }>();
	const scheduler: Scheduler = {
		now: () => current,
		setTimer: (callback, delayMs) => {
			tasks.set(nextId++, { time: current + delayMs, callback });
		},
	};
	function advance(ms: number): void {
		const target = current + ms;
		for (;;) {
			let dueId: number | null = null;
			let dueTime = Number.POSITIVE_INFINITY;
			for (const [id, task] of tasks) {
				if (task.time <= target && task.time < dueTime) {
					dueId = id;
					dueTime = task.time;
				}
			}
			if (dueId === null) break;
			const task = tasks.get(dueId);
			assert(task !== undefined);
			tasks.delete(dueId);
			current = task.time;
			task.callback();
		}
		current = target;
	}
	return { scheduler, advance, pendingTimerCount: () => tasks.size };
}

const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("initSaveProgressSequencer", () => {
	it("holds the capturing milestone for the full dwell even when uploading arrives near-instantly", () => {
		const applied: SavePhase[] = [];
		const clock = makeFakeClock();
		const sequencer = initSaveProgressSequencer({
			minDwellMs: 450,
			scheduler: clock.scheduler,
			apply: (phase) => applied.push(phase),
		});

		sequencer.enqueue("capturing");
		sequencer.enqueue("uploading");
		assert.deepEqual(applied, ["capturing"], "capturing shows; uploading must wait");

		clock.advance(449);
		assert.deepEqual(applied, ["capturing"], "uploading still held one ms before the dwell");

		clock.advance(1);
		assert.deepEqual(applied, ["capturing", "uploading"], "uploading applies once the dwell elapses");
	});

	it("applies the first phase immediately without waiting for the clock", () => {
		const applied: SavePhase[] = [];
		const clock = makeFakeClock();
		const sequencer = initSaveProgressSequencer({
			minDwellMs: 450,
			scheduler: clock.scheduler,
			apply: (phase) => applied.push(phase),
		});

		sequencer.enqueue("capturing");
		assert.deepEqual(applied, ["capturing"]);
	});

	it("applies queued phases in FIFO order and never skips an intermediate phase", () => {
		const applied: SavePhase[] = [];
		const clock = makeFakeClock();
		const sequencer = initSaveProgressSequencer({
			minDwellMs: 100,
			scheduler: clock.scheduler,
			apply: (phase) => applied.push(phase),
		});

		sequencer.enqueue("capturing");
		sequencer.enqueue("uploading");
		clock.advance(100);
		assert.deepEqual(applied, ["capturing", "uploading"]);
	});

	it("queues multiple rapid enqueues and flushes each after its own dwell", () => {
		const applied: SavePhase[] = [];
		const clock = makeFakeClock();
		const sequencer = initSaveProgressSequencer({
			minDwellMs: 50,
			scheduler: clock.scheduler,
			apply: (phase) => applied.push(phase),
		});

		sequencer.enqueue("capturing");
		sequencer.enqueue("uploading");
		sequencer.enqueue("uploading");
		assert.deepEqual(applied, ["capturing"], "only the first phase shows immediately");

		clock.advance(50);
		assert.deepEqual(applied, ["capturing", "uploading"], "second phase after one dwell");

		clock.advance(50);
		assert.deepEqual(applied, ["capturing", "uploading", "uploading"], "third phase after a second dwell");
	});

	it("applies a late-arriving phase immediately when the prior phase already exceeded its dwell", () => {
		const applied: SavePhase[] = [];
		const clock = makeFakeClock();
		const sequencer = initSaveProgressSequencer({
			minDwellMs: 100,
			scheduler: clock.scheduler,
			apply: (phase) => applied.push(phase),
		});

		sequencer.enqueue("capturing");
		clock.advance(200);
		sequencer.enqueue("uploading");
		assert.deepEqual(applied, ["capturing", "uploading"], "no extra wait once the dwell is already spent");
		assert.equal(clock.pendingTimerCount(), 0, "no timer scheduled for an already-due phase");
	});

	it("drains a pending queue in order before finish resolves", async () => {
		const applied: SavePhase[] = [];
		let resolved = false;
		const clock = makeFakeClock();
		const sequencer = initSaveProgressSequencer({
			minDwellMs: 100,
			scheduler: clock.scheduler,
			apply: (phase) => applied.push(phase),
		});

		sequencer.enqueue("capturing");
		sequencer.enqueue("uploading");
		const finished = sequencer.finish().then(() => {
			resolved = true;
		});

		await flushMicrotasks();
		assert.equal(resolved, false, "finish stays pending while uploading is queued");

		clock.advance(100);
		await finished;
		assert.equal(resolved, true);
		assert.deepEqual(applied, ["capturing", "uploading"], "every phase applied before resolution");
	});

	it("resolves finish immediately when the queue is idle", async () => {
		const clock = makeFakeClock();
		const sequencer = initSaveProgressSequencer({
			minDwellMs: 100,
			scheduler: clock.scheduler,
			apply: () => {},
		});

		sequencer.enqueue("capturing");
		clock.advance(100);

		let resolved = false;
		await sequencer.finish().then(() => {
			resolved = true;
		});
		assert.equal(resolved, true);
		assert.equal(clock.pendingTimerCount(), 0);
	});

	it("resolves finish on a never-enqueued sequencer without applying any phase", async () => {
		const applied: SavePhase[] = [];
		const clock = makeFakeClock();
		const sequencer = initSaveProgressSequencer({
			minDwellMs: 100,
			scheduler: clock.scheduler,
			apply: (phase) => applied.push(phase),
		});

		let resolved = false;
		await sequencer.finish().then(() => {
			resolved = true;
		});
		assert.equal(resolved, true);
		assert.deepEqual(applied, []);
	});
});
