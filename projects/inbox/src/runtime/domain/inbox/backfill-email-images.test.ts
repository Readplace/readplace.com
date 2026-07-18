import { MessageIdSchema, type ParseEmailResult } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import {
	type BackfillEmailRow,
	BackfillEmailRowSchema,
	initBackfillEmailImages,
} from "./backfill-email-images";
import { emailContentResourceId } from "./email-content-id";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const OTHER = UserIdSchema.parse("00000000000000000000000000000002");
const RECEIVED_AT = "2026-07-16T16:42:03.359Z";

function ramFor(local: string): string {
	return `${RECEIVED_AT}#<${local}@x>`;
}
const RAM = ramFor("m");

function row(overrides?: Partial<BackfillEmailRow>): BackfillEmailRow {
	const userId = overrides?.userId ?? USER;
	const receivedAtMessageId = overrides?.receivedAtMessageId ?? RAM;
	return {
		userId,
		receivedAtMessageId,
		status: "received",
		receivedAt: RECEIVED_AT,
		rawEmailS3Key: "inbound/raw-1",
		bodyS3Key: emailContentResourceId({ userId, receivedAtMessageId }).toS3ContentKey(),
		...overrides,
	};
}

function parsedOk(html: string): ParseEmailResult {
	return {
		ok: true,
		email: {
			from: "news@example.com",
			subject: "Digest",
			text: "text",
			html,
			messageId: MessageIdSchema.parse("<m@x>"),
			receivedAt: RECEIVED_AT,
			inlineImages: [],
			listUnsubscribeUrls: [],
		},
	};
}

function makeHarness(opts?: {
	rows?: BackfillEmailRow[][];
	dryRun?: boolean;
	onlyUserId?: string;
	readRawEmail?: (s3Key: string) => Promise<Buffer | undefined>;
	parseEmail?: () => Promise<ParseEmailResult>;
	storeBody?: () => Promise<string | undefined>;
}) {
	const downloadCalls: string[] = [];
	const storeCalls: { userId: string; receivedAtMessageId: string }[] = [];
	const sleeps: number[] = [];
	const run = initBackfillEmailImages({
		scanEmailRowPages: async function* () {
			yield* opts?.rows ?? [[row()]];
		},
		readRawEmail: opts?.readRawEmail ?? (async () => Buffer.from("raw eml")),
		parseEmail: opts?.parseEmail ?? (async () => parsedOk("<p>hi</p>")),
		downloadEmailImages: async ({ html }) => {
			downloadCalls.push(html);
			return [];
		},
		storeBody: async ({ userId, receivedAtMessageId }) => {
			storeCalls.push({ userId, receivedAtMessageId });
			return opts?.storeBody ? opts.storeBody() : "content/x/content.html";
		},
		logger: HutchLogger.from(noopLogger),
		dryRun: opts?.dryRun ?? false,
		onlyUserId: opts?.onlyUserId,
		sleepBetweenRows: async () => {
			sleeps.push(1);
		},
	});
	return { run, downloadCalls, storeCalls, sleeps };
}

describe("BackfillEmailRowSchema", () => {
	it("accepts a row missing bodyS3Key and strips unknown attributes", () => {
		const parsed = BackfillEmailRowSchema.parse({
			userId: USER,
			receivedAtMessageId: RAM,
			status: "rejected",
			receivedAt: RECEIVED_AT,
			rawEmailS3Key: "inbound/raw-1",
			subject: "extra attribute the projection may include",
		});

		expect(parsed.bodyS3Key).toBeUndefined();
		expect("subject" in parsed).toBe(false);
	});
});

describe("initBackfillEmailImages", () => {
	it("re-derives received rows across pages through download and store, pausing between rows", async () => {
		const { run, downloadCalls, storeCalls, sleeps } = makeHarness({
			rows: [[row()], [row({ receivedAtMessageId: ramFor("n") })]],
		});

		const tally = await run();

		expect(tally.rewritten).toBe(2);
		expect(downloadCalls).toHaveLength(2);
		expect(storeCalls[0]).toEqual({ userId: USER, receivedAtMessageId: RAM });
		expect(sleeps).toHaveLength(2);
	});

	it("counts a dry run without touching S3 or the network", async () => {
		const { run, downloadCalls, storeCalls } = makeHarness({ dryRun: true });

		const tally = await run();

		expect(tally["would-rewrite"]).toBe(1);
		expect(downloadCalls).toHaveLength(0);
		expect(storeCalls).toHaveLength(0);
	});

	it("filters rows that are not backfillable", async () => {
		const { run, storeCalls } = makeHarness({
			rows: [
				[
					row({ status: "rejected", bodyS3Key: undefined }),
					row({ status: "received", bodyS3Key: undefined }),
					row({ userId: UserIdSchema.parse("__unrouted__") }),
					row({ bodyS3Key: "content/some-legacy-key/content.html" }),
				],
			],
		});

		const tally = await run();

		expect(tally["skipped-not-received"]).toBe(1);
		expect(tally["skipped-no-body"]).toBe(1);
		expect(tally["skipped-unrouted"]).toBe(1);
		expect(tally["key-mismatch"]).toBe(1);
		expect(storeCalls).toHaveLength(0);
	});

	it("processes only the requested user when onlyUserId is set", async () => {
		const { run, storeCalls } = makeHarness({
			onlyUserId: USER,
			rows: [[row(), row({ userId: OTHER, receivedAtMessageId: ramFor("o") })]],
		});

		const tally = await run();

		expect(tally.rewritten).toBe(1);
		expect(tally["skipped-other-user"]).toBe(1);
		expect(storeCalls).toEqual([{ userId: USER, receivedAtMessageId: RAM }]);
	});

	it("records missing raw, unparseable, and empty-after-sanitize outcomes", async () => {
		const missingRaw = makeHarness({ readRawEmail: async () => undefined });
		expect((await missingRaw.run())["missing-raw"]).toBe(1);

		const unparseable = makeHarness({
			parseEmail: async () => ({ ok: false, reason: "unparseable" }),
		});
		expect((await unparseable.run()).unparseable).toBe(1);

		const empty = makeHarness({ storeBody: async () => undefined });
		expect((await empty.run())["empty-after-sanitize"]).toBe(1);
	});

	it("logs a throwing row as failed and keeps processing the rest", async () => {
		const { run } = makeHarness({
			rows: [
				[
					row(),
					row({ receivedAtMessageId: ramFor("p"), rawEmailS3Key: "inbound/raw-2" }),
				],
			],
			readRawEmail: async (s3Key) => {
				if (s3Key === "inbound/raw-1") throw new Error("s3 outage");
				return Buffer.from("raw eml");
			},
		});

		const tally = await run();

		expect(tally.failed).toBe(1);
		expect(tally.rewritten).toBe(1);
	});
});
