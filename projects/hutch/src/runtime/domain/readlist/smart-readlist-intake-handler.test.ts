import assert from "node:assert/strict";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { MatchSmartReadlistsCommand } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { ReadlistDefinitionData } from "@packages/provider-contracts/article-store";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { AttributeValue, DynamoDBRecord } from "aws-lambda";
import { initSmartReadlistIntakeHandler } from "./smart-readlist-intake-handler";

const USER = "00000000000000000000000000000001";
const SAVED_AT = "2026-11-20T10:00:00.000Z";
const STORED_KEY = "example.com/post";

function smartList(effectiveAt: string): ReadlistDefinitionData {
	return {
		slug: ReadlistSlugSchema.parse("a1b2c3d4"),
		label: "Work",
		createdAt: new Date("2026-11-01T00:00:00.000Z"),
		filing: { mode: "smart", purpose: "Engineering practice", revision: 2, effectiveAt: new Date(effectiveAt) },
	};
}

const MANUAL_LIST: ReadlistDefinitionData = {
	slug: ReadlistSlugSchema.parse("b1b2c3d4"),
	label: "Later",
	createdAt: new Date("2026-11-01T00:00:00.000Z"),
	filing: { mode: "manual" },
};

function streamRecord(params: {
	eventName?: "INSERT" | "MODIFY" | "REMOVE";
	sequenceNumber?: string;
	image?: Record<string, AttributeValue>;
}): DynamoDBRecord {
	return {
		eventName: params.eventName ?? "INSERT",
		dynamodb: {
			SequenceNumber: params.sequenceNumber ?? "100",
			NewImage: params.image ?? {
				userId: { S: USER },
				url: { S: STORED_KEY },
				savedAt: { S: SAVED_AT },
			},
		},
	};
}

function makeHarness(opts: { definitions?: ReadlistDefinitionData[]; listFails?: boolean }) {
	const published: { detailType: string; detail: unknown }[] = [];
	const logged: unknown[][] = [];
	const capture = (...args: unknown[]) => {
		logged.push(args);
	};
	const logger: Logger = { info: capture, error: capture, warn: capture, debug: capture };
	const publishEvent: PublishEvent = async (event, detail) => {
		published.push({ detailType: event.detailType, detail });
	};
	const handler = initSmartReadlistIntakeHandler({
		listReadlistDefinitions: async () => {
			if (opts.listFails) throw new Error("DynamoDB unavailable");
			return opts.definitions ?? [smartList("2026-11-10T00:00:00.000Z")];
		},
		publishEvent,
		logger,
	});
	const run = async (records: DynamoDBRecord[]) => {
		const result = await handler({ Records: records }, buildLambdaContext(), () => {});
		assert(result, "the intake returns a batch response");
		return result;
	};
	return { run, published, logged };
}

describe("initSmartReadlistIntakeHandler", () => {
	it("leaves an email save to the email path", async () => {
		const h = makeHarness({});

		const result = await h.run([
			streamRecord({
				image: {
					userId: { S: USER },
					url: { S: STORED_KEY },
					savedAt: { S: SAVED_AT },
					provenance: { M: { kind: { S: "email" }, senderEmail: { S: "news@example.com" } } },
				},
			}),
		]);

		expect(result.batchItemFailures).toEqual([]);
		expect(h.published).toEqual([]);
	});

	it("matches a save whose provenance is not email", async () => {
		const h = makeHarness({});

		await h.run([
			streamRecord({
				image: {
					userId: { S: USER },
					url: { S: STORED_KEY },
					savedAt: { S: SAVED_AT },
					provenance: { M: { kind: { S: "web" } } },
				},
			}),
		]);

		expect(h.published).toEqual([
			{
				detailType: MatchSmartReadlistsCommand.detailType,
				detail: { userId: UserIdSchema.parse(USER), storedKey: STORED_KEY, savedAt: SAVED_AT },
			},
		]);
	});

	it("publishes a match command for a new save in All while a smart readlist's rule covers it", async () => {
		const h = makeHarness({});

		const result = await h.run([streamRecord({})]);

		expect(result.batchItemFailures).toEqual([]);
		expect(h.published).toEqual([
			{
				detailType: MatchSmartReadlistsCommand.detailType,
				detail: { userId: UserIdSchema.parse(USER), storedKey: STORED_KEY, savedAt: SAVED_AT },
			},
		]);
	});

	it.each([
		["a list copy", { userId: { S: `${USER}#queue/a1b2c3d4` }, url: { S: STORED_KEY }, savedAt: { S: SAVED_AT } }],
		["a removal marker", { userId: { S: `${USER}#removed` }, url: { S: STORED_KEY }, savedAt: { S: SAVED_AT } }],
		["a definition row", { userId: { S: USER }, url: { S: "readplace:readlist/a1b2c3d4" }, savedAt: { S: SAVED_AT } }],
		[
			"a highlight",
			{ userId: { S: USER }, url: { S: "highlight#1" }, savedAt: { S: SAVED_AT }, highlightOf: { S: STORED_KEY } },
		],
		["a restore", { userId: { S: USER }, url: { S: STORED_KEY }, savedAt: { S: SAVED_AT }, restoredAt: { S: SAVED_AT } }],
		["a row with no savedAt", { userId: { S: USER }, url: { S: STORED_KEY } }],
	])("ignores %s", async (_label, image) => {
		const h = makeHarness({});

		const result = await h.run([streamRecord({ image })]);

		expect(result.batchItemFailures).toEqual([]);
		expect(h.published).toEqual([]);
	});

	it.each(["MODIFY", "REMOVE"] as const)("ignores a %s of an All row", async (eventName) => {
		const h = makeHarness({});

		await h.run([streamRecord({ eventName })]);

		expect(h.published).toEqual([]);
	});

	it("ignores a save when the reader has no smart readlist", async () => {
		const h = makeHarness({ definitions: [MANUAL_LIST] });

		await h.run([streamRecord({})]);

		expect(h.published).toEqual([]);
	});

	it("ignores a save made before the smart rule took effect", async () => {
		const h = makeHarness({ definitions: [smartList("2026-11-20T10:00:01.000Z")] });

		await h.run([streamRecord({})]);

		expect(h.published).toEqual([]);
	});

	it("reports only the record whose intake failed", async () => {
		const h = makeHarness({ listFails: true });

		const result = await h.run([streamRecord({ sequenceNumber: "200" }), streamRecord({ eventName: "MODIFY" })]);

		expect(result.batchItemFailures).toEqual([{ itemIdentifier: "200" }]);
		expect(h.logged).toHaveLength(1);
	});
});
