import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { type BulkSaveRun, type BulkSaveRunId, BulkSaveRunIdSchema } from "../bulk-save-run/bulk-save-run";
import type { FollowSaveAllReply } from "../bulk-save-run/save-all-messages";
import { WindowIdSchema } from "../domain/window-id";
import { LOST, type Lost, initSaveAllFollower } from "./save-all-follower";

const RUN_ID = BulkSaveRunIdSchema.parse("6f1c2a4e-1d1b-4c55-9a77-0d5e3f2b8a10");
const JOINED_ID = BulkSaveRunIdSchema.parse("0b8e5d3c-7a6f-4e21-8c3d-2f1a9b7c6d54");
const OTHER_ID = BulkSaveRunIdSchema.parse("22222222-2222-4222-8222-222222222222");

function run(overrides: Partial<BulkSaveRun> = {}): BulkSaveRun {
	return {
		id: RUN_ID,
		windowId: WindowIdSchema.parse(1),
		joinedIds: [],
		epoch: 0,
		revision: 1,
		phase: "running",
		links: [],
		clientSkips: [],
		notified: false,
		outcomeSeen: false,
		...overrides,
	};
}

function createFollower(replies: (FollowSaveAllReply | Lost)[] = []) {
	const events: string[] = [];
	const painted: BulkSaveRun[] = [];
	const follows: BulkSaveRunId[] = [];
	const errors: unknown[] = [];
	let acknowledge: () => Promise<unknown> = async () => ({ ok: true });
	const follower = initSaveAllFollower({
		sendFollow: async (runId) => {
			follows.push(runId);
			return replies.shift() ?? LOST;
		},
		sendAcknowledge: (runId) => {
			events.push(`acknowledge:${runId}`);
			return acknowledge();
		},
		paint: (painting) => {
			painted.push(painting);
			events.push(`paint:${painting.phase}:${painting.revision}`);
		},
		showFailure: () => events.push("failure"),
		showLogin: () => events.push("login"),
		mark: () => events.push("mark"),
		logger: HutchLogger.from({ ...noopLogger, error: (...args: unknown[]) => errors.push(args) }),
	});
	return {
		follower,
		events,
		painted,
		follows,
		errors,
		failAcknowledge: () => {
			acknowledge = async () => {
				throw new Error("gone");
			};
		},
	};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("initSaveAllFollower", () => {
	it("paints the start's run, follows it, and acknowledges the outcome before the mark", async () => {
		const finished = run({ phase: "finished", revision: 5 });
		const { follower, events, follows } = createFollower([{ ok: true, run: finished }]);
		follower.bind(RUN_ID);

		await follower.started({ runId: RUN_ID, reply: { ok: true, run: run() } });

		expect(follows).toEqual([RUN_ID]);
		expect(events).toEqual(["paint:running:1", "paint:finished:5", `acknowledge:${RUN_ID}`, "mark"]);
	});

	it("does not follow a start already answered with a finished outcome", async () => {
		const { follower, events, follows } = createFollower();
		follower.bind(RUN_ID);

		await follower.started({ runId: RUN_ID, reply: { ok: true, run: run({ phase: "finished" }) } });

		expect(follows).toEqual([]);
		expect(events).toEqual(["paint:finished:1", `acknowledge:${RUN_ID}`, "mark"]);
	});

	it("shows the sign-in view for a start refused as signed out", async () => {
		const { follower, events } = createFollower();
		follower.bind(RUN_ID);

		await follower.started({ runId: RUN_ID, reply: { ok: false, reason: "not-logged-in" } });

		expect(events).toEqual(["login"]);
	});

	it("finds the run with one follow after a lost or failed start", async () => {
		const { follower, events, follows } = createFollower([
			{ ok: true, run: run({ phase: "finished" }) },
			{ ok: true, run: run({ phase: "finished" }) },
		]);
		follower.bind(RUN_ID);
		await follower.started({ runId: RUN_ID, reply: LOST });
		follower.bind(OTHER_ID);
		await follower.started({ runId: OTHER_ID, reply: { ok: false, reason: "error" } });

		expect(follows).toEqual([RUN_ID, OTHER_ID]);
		expect(events.filter((event) => event === "mark")).toHaveLength(1);
	});

	it("tells the reader the save failed when the follow finds no run", async () => {
		const { follower, events } = createFollower([{ ok: true, run: null }]);
		follower.bind(RUN_ID);

		await follower.started({ runId: RUN_ID, reply: LOST });

		expect(events).toEqual(["failure"]);
	});

	it("follows once more after a lost follow, and fails on a second loss", async () => {
		const recovered = createFollower([LOST, { ok: true, run: run({ phase: "finished" }) }]);
		recovered.follower.bind(RUN_ID);
		await recovered.follower.started({ runId: RUN_ID, reply: { ok: true, run: run() } });

		const lost = createFollower([{ ok: false, reason: "error" }, LOST, { ok: true, run: run({ phase: "finished" }) }]);
		lost.follower.bind(RUN_ID);
		await lost.follower.started({ runId: RUN_ID, reply: { ok: true, run: run() } });

		expect(recovered.follows).toHaveLength(2);
		expect(recovered.events.at(-1)).toBe("mark");
		expect(lost.follows).toHaveLength(2);
		expect(lost.events.at(-1)).toBe("failure");
	});

	it("drops a reply that arrives after a second Save all rebound the view", async () => {
		const { follower, events } = createFollower([{ ok: true, run: run({ phase: "finished" }) }]);
		follower.bind(RUN_ID);
		const following = follower.started({ runId: RUN_ID, reply: { ok: true, run: run() } });
		follower.bind(OTHER_ID);
		await following;
		await follower.started({ runId: RUN_ID, reply: { ok: true, run: run() } });

		expect(events).toEqual(["paint:running:1"]);
	});

	it("repaints from records of its own run that are newer, by id or joined id, and ignores the rest", () => {
		const { follower, events } = createFollower();
		follower.bind(JOINED_ID);
		const other = run({ id: OTHER_ID, revision: 9 });

		follower.recordsChanged([other]);
		follower.recordsChanged([other, run({ joinedIds: [JOINED_ID], revision: 2 })]);
		follower.recordsChanged([other, run({ joinedIds: [JOINED_ID], revision: 2 })]);
		follower.recordsChanged([run({ joinedIds: [JOINED_ID], revision: 1 })]);
		follower.recordsChanged([run({ joinedIds: [JOINED_ID], epoch: 1, revision: 1 })]);
		follower.recordsChanged([]);

		expect(events).toEqual(["paint:running:2", "paint:running:1"]);
	});

	it("ignores records before it is bound to a run", () => {
		const { follower, events } = createFollower();

		follower.recordsChanged([run()]);

		expect(events).toEqual([]);
	});

	it("lets a follow reply replace a newer record it already painted", async () => {
		const { follower, painted } = createFollower([{ ok: true, run: run({ phase: "finished", revision: 3 }) }]);
		follower.bind(RUN_ID);
		const following = follower.started({ runId: RUN_ID, reply: { ok: true, run: run() } });
		follower.recordsChanged([run({ revision: 8 })]);
		await following;

		expect(painted.map((held) => held.revision)).toEqual([1, 8, 3]);
	});

	it("repaints a retry after the outcome without a second mark, and marks a second run again", () => {
		const { follower, events } = createFollower();
		follower.bind(RUN_ID);
		follower.recordsChanged([run({ phase: "finished", revision: 2 })]);
		follower.recordsChanged([run({ phase: "finished", revision: 3 })]);
		follower.bind(OTHER_ID);
		follower.recordsChanged([run({ id: OTHER_ID, phase: "finished", revision: 1 })]);

		expect(events.filter((event) => event === "mark")).toHaveLength(2);
		expect(events.filter((event) => event.startsWith("paint"))).toHaveLength(3);
	});

	it("follows a run a reopened popup found, from its stored state", async () => {
		const { follower, events, follows } = createFollower([{ ok: true, run: run({ phase: "finished", revision: 4 }) }]);

		await follower.followRun(run({ revision: 2 }));

		expect(follows).toEqual([RUN_ID]);
		expect(events).toEqual(["paint:running:2", "paint:finished:4", `acknowledge:${RUN_ID}`, "mark"]);
	});

	it("logs an acknowledgement that never arrived", async () => {
		const { follower, errors, failAcknowledge } = createFollower();
		failAcknowledge();
		follower.bind(RUN_ID);

		follower.recordsChanged([run({ phase: "finished" })]);
		await flush();

		expect(errors).toHaveLength(1);
	});
});
