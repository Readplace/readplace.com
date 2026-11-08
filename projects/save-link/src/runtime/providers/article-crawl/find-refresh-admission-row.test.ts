import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initFindRefreshAdmissionRow } from "./find-refresh-admission-row";

type SendFn = DynamoDBDocumentClient["send"];
type SentCommand = { name: string; input: Record<string, unknown> };

const TABLE = "test-articles";

function createFakeClient(item: Record<string, unknown> | undefined): { client: Partial<DynamoDBDocumentClient>; sent: SentCommand[] } {
	const sent: SentCommand[] = [];
	const send = (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
		sent.push({ name: command.constructor.name, input: command.input });
		return item === undefined ? {} : { Item: item };
	}) as SendFn;
	return { client: { send }, sent };
}

function findWith(client: Partial<DynamoDBDocumentClient>) {
	assert(client.send);
	return initFindRefreshAdmissionRow({ client: { send: client.send }, tableName: TABLE }).findRefreshAdmissionRow;
}

describe("initFindRefreshAdmissionRow", () => {
	it("reads the four admission columns consistently, keyed by the article's identity without tracking parameters", async () => {
		const { client, sent } = createFakeClient(undefined);

		await findWith(client)("https://example.com/post?utm_source=newsletter");

		assert.deepEqual(sent, [{
			name: "GetCommand",
			input: {
				TableName: TABLE,
				Key: { url: "example.com/post" },
				ProjectionExpression: "#purgedAt, #contentFetchedAt, #savedAt, #crawlStatus",
				ExpressionAttributeNames: {
					"#purgedAt": "purgedAt",
					"#contentFetchedAt": "contentFetchedAt",
					"#savedAt": "savedAt",
					"#crawlStatus": "crawlStatus",
				},
				ConsistentRead: true,
			},
		}]);
	});

	it("maps a full item, keeping an unknown crawl status as written", async () => {
		const { client } = createFakeClient({
			url: "example.com/post",
			purgedAt: "2026-05-11T00:00:00.000Z",
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
			savedAt: "2026-05-09T12:00:00.000Z",
			crawlStatus: "legacy-status",
		});

		assert.deepEqual(await findWith(client)("https://example.com/post"), {
			purgedAt: "2026-05-11T00:00:00.000Z",
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
			savedAt: "2026-05-09T12:00:00.000Z",
			crawlStatus: "legacy-status",
		});
	});

	it("returns undefined when the article has no row", async () => {
		const { client } = createFakeClient(undefined);

		assert.equal(await findWith(client)("https://example.com/post"), undefined);
	});
});
