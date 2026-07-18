import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initPruneCrawlVersions } from "./prune-crawl-versions";

/**
 * 1. The DocumentClient `send` is a heavily-overloaded generic the test fake
 *    cannot structurally satisfy; the single contained cast is the isolated
 *    SDK-wrapper exception in CLAUDE.md "Avoid TypeScript Type Assertions".
 */
function createFakeDynamo(opts: {
	getItem: Record<string, unknown> | undefined;
	captureUpdate?: (input: Record<string, unknown>) => void;
}): DynamoDBDocumentClient {
	const send = async (command: { input: Record<string, unknown> }) => {
		if (command.input.UpdateExpression !== undefined) {
			opts.captureUpdate?.(command.input);
			return {};
		}
		return opts.getItem === undefined ? {} : { Item: opts.getItem };
	};
	return { send } as unknown as DynamoDBDocumentClient /* 1 */;
}

const TABLE = "articles";
const URL = "https://example.com/post";

describe("initPruneCrawlVersions", () => {
	it("drops the named minute-ids with a compare-and-swap on the raw stored log", async () => {
		let update: Record<string, unknown> | undefined;
		const legacyAndAttributed = [
			{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" },
			"2026-06-28T22:01Z",
			{ minuteId: "2026-03-26T14:32Z", authorUserId: "user-2" },
		];
		const { pruneCrawlVersions } = initPruneCrawlVersions({
			client: createFakeDynamo({
				getItem: { crawlVersions: legacyAndAttributed },
				captureUpdate: (input) => {
					update = input;
				},
			}),
			tableName: TABLE,
		});

		await pruneCrawlVersions({ url: URL, minuteIds: ["2026-07-10T09:41Z"] });

		expect(update).toEqual({
			TableName: TABLE,
			Key: { url: "example.com/post" },
			UpdateExpression: "SET crawlVersions = :next",
			ConditionExpression: "crawlVersions = :old",
			ExpressionAttributeValues: {
				":next": ["2026-06-28T22:01Z", { minuteId: "2026-03-26T14:32Z", authorUserId: "user-2" }],
				":old": legacyAndAttributed,
			},
		});
	});

	it("prunes legacy bare-string entries by their minute-id", async () => {
		let update: Record<string, unknown> | undefined;
		const { pruneCrawlVersions } = initPruneCrawlVersions({
			client: createFakeDynamo({
				getItem: { crawlVersions: ["2026-07-10T09:41Z", "2026-06-28T22:01Z"] },
				captureUpdate: (input) => {
					update = input;
				},
			}),
			tableName: TABLE,
		});

		await pruneCrawlVersions({ url: URL, minuteIds: ["2026-06-28T22:01Z"] });

		expect(update?.ExpressionAttributeValues).toEqual({
			":next": ["2026-07-10T09:41Z"],
			":old": ["2026-07-10T09:41Z", "2026-06-28T22:01Z"],
		});
	});

	it("is a no-op when no minute-ids are given", async () => {
		let updated = false;
		const { pruneCrawlVersions } = initPruneCrawlVersions({
			client: createFakeDynamo({
				getItem: { crawlVersions: ["2026-07-10T09:41Z"] },
				captureUpdate: () => {
					updated = true;
				},
			}),
			tableName: TABLE,
		});

		await pruneCrawlVersions({ url: URL, minuteIds: [] });

		expect(updated).toBe(false);
	});

	it("is a no-op when the row has no log attribute (already pruned or never recorded)", async () => {
		let updated = false;
		const { pruneCrawlVersions } = initPruneCrawlVersions({
			client: createFakeDynamo({
				getItem: {},
				captureUpdate: () => {
					updated = true;
				},
			}),
			tableName: TABLE,
		});

		await pruneCrawlVersions({ url: URL, minuteIds: ["2026-07-10T09:41Z"] });

		expect(updated).toBe(false);
	});

	it("is a no-op when the row itself is gone", async () => {
		let updated = false;
		const { pruneCrawlVersions } = initPruneCrawlVersions({
			client: createFakeDynamo({
				getItem: undefined,
				captureUpdate: () => {
					updated = true;
				},
			}),
			tableName: TABLE,
		});

		await pruneCrawlVersions({ url: URL, minuteIds: ["2026-07-10T09:41Z"] });

		expect(updated).toBe(false);
	});

	it("is a no-op when none of the minute-ids are present (redelivery convergence)", async () => {
		let updated = false;
		const { pruneCrawlVersions } = initPruneCrawlVersions({
			client: createFakeDynamo({
				getItem: { crawlVersions: ["2026-07-10T09:41Z"] },
				captureUpdate: () => {
					updated = true;
				},
			}),
			tableName: TABLE,
		});

		await pruneCrawlVersions({ url: URL, minuteIds: ["2026-01-01T00:00Z"] });

		expect(updated).toBe(false);
	});
});
