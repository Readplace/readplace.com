import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import {
	type BackfillLinksRow,
	BackfillLinksRowSchema,
	initBackfillEmailLinks,
} from "./backfill-email-links";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const OTHER = UserIdSchema.parse("00000000000000000000000000000002");
const RAM = "2026-07-16T16:42:03.359Z#<m@x>";

function row(overrides?: Partial<BackfillLinksRow>): BackfillLinksRow {
	return {
		userId: USER,
		receivedAtMessageId: RAM,
		status: "received",
		recipientAddress: "node-weekly-hxi5ao@read.place",
		...overrides,
	};
}

function makeHarness(opts?: {
	rows?: BackfillLinksRow[][];
	dryRun?: boolean;
	onlyUserId?: string;
	deleteEmailLinks?: (input: { userId: string; receivedAtMessageId: string }) => Promise<void>;
}) {
	const deletes: { userId: string; receivedAtMessageId: string }[] = [];
	const published: { receivedAtMessageId: string; recipientAddress: string }[] = [];
	const sleeps: number[] = [];
	const run = initBackfillEmailLinks({
		scanEmailRowPages: async function* () {
			yield* opts?.rows ?? [[row()]];
		},
		deleteEmailLinks:
			opts?.deleteEmailLinks ??
			(async (input) => {
				deletes.push(input);
			}),
		publishEmailReceived: async ({ receivedAtMessageId, recipientAddress }) => {
			published.push({ receivedAtMessageId, recipientAddress });
		},
		logger: HutchLogger.from(noopLogger),
		dryRun: opts?.dryRun ?? false,
		onlyUserId: opts?.onlyUserId,
		receivedBefore: "2026-07-18T00:00:00.000Z",
		sleepBetweenRows: async () => {
			sleeps.push(1);
		},
	});
	return { run, deletes, published, sleeps };
}

describe("BackfillLinksRowSchema", () => {
	it("strips unknown attributes the projection may include", () => {
		const parsed = BackfillLinksRowSchema.parse({
			userId: USER,
			receivedAtMessageId: RAM,
			status: "received",
			recipientAddress: "in-3f9a2c@read.place",
			subject: "extra",
		});

		expect("subject" in parsed).toBe(false);
	});
});

describe("initBackfillEmailLinks", () => {
	it("deletes each email's link rows before re-publishing its received event, pacing between rows", async () => {
		const secondRam = RAM.replace("m@x", "n@x");
		const { run, deletes, published, sleeps } = makeHarness({
			rows: [[row()], [row({ receivedAtMessageId: secondRam })]],
		});

		const tally = await run();

		expect(tally["re-extracted"]).toBe(2);
		expect(deletes).toEqual([
			{ userId: USER, receivedAtMessageId: RAM },
			{ userId: USER, receivedAtMessageId: secondRam },
		]);
		expect(published).toEqual([
			{ receivedAtMessageId: RAM, recipientAddress: "node-weekly-hxi5ao@read.place" },
			{ receivedAtMessageId: secondRam, recipientAddress: "node-weekly-hxi5ao@read.place" },
		]);
		expect(sleeps).toHaveLength(2);
	});

	it("counts a dry run without deleting or publishing anything", async () => {
		const { run, deletes, published } = makeHarness({ dryRun: true });

		const tally = await run();

		expect(tally["would-re-extract"]).toBe(1);
		expect(deletes).toHaveLength(0);
		expect(published).toHaveLength(0);
	});

	it("filters non-received, unrouted, other users', and mid-run-received rows", async () => {
		const { run, published } = makeHarness({
			onlyUserId: USER,
			rows: [
				[
					row({ status: "rejected" }),
					row({ userId: UserIdSchema.parse("__unrouted__") }),
					row({ userId: OTHER }),
					// Received after the run started: its receive-time extraction may
					// still be in flight, and it already has the current classification.
					row({ receivedAtMessageId: "2026-07-18T09:00:00.000Z#<fresh@x>" }),
					row(),
				],
			],
		});

		const tally = await run();

		expect(tally["skipped-not-received"]).toBe(1);
		expect(tally["skipped-unrouted"]).toBe(1);
		expect(tally["skipped-other-user"]).toBe(1);
		expect(tally["skipped-received-after-start"]).toBe(1);
		expect(tally["re-extracted"]).toBe(1);
		expect(published).toHaveLength(1);
	});

	it("logs a throwing row as failed without publishing its event, and keeps going", async () => {
		const secondRam = RAM.replace("m@x", "p@x");
		const { run, published } = makeHarness({
			rows: [[row(), row({ receivedAtMessageId: secondRam })]],
			deleteEmailLinks: async ({ receivedAtMessageId }) => {
				if (receivedAtMessageId === RAM) throw new Error("ddb outage");
			},
		});

		const tally = await run();

		expect(tally.failed).toBe(1);
		expect(tally["re-extracted"]).toBe(1);
		// The failed email must NOT get an event: extraction would run against
		// surviving stale rows whose conditional puts keep the old classification.
		expect(published).toEqual([
			{ receivedAtMessageId: secondRam, recipientAddress: "node-weekly-hxi5ao@read.place" },
		]);
	});
});
