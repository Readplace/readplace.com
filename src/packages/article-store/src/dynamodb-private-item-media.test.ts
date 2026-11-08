import assert from "node:assert/strict";
import { ItemMediaSchema, ReaderArticleHashId } from "@packages/domain/article";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { EnclosureSchema } from "@packages/media-contracts";
import { initDynamoDbPrivateItemMedia } from "./dynamodb-private-item-media";

type SendFn = DynamoDBDocumentClient["send"];

interface Sent {
	command: string;
	input: Record<string, unknown>;
}

function harness(answer: (sent: Sent) => unknown) {
	const sent: Sent[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const call = { command: command.constructor.name, input: command.input };
			sent.push(call);
			return answer(call);
		}) as unknown as SendFn,
	} as Partial<DynamoDBDocumentClient> as DynamoDBDocumentClient;
	const store = initDynamoDbPrivateItemMedia({ client, tableName: "articles" });
	return { store, sent };
}

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const KEY = "uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const ENCLOSURE = EnclosureSchema.parse({
	object: `objects/sha256/${"c".repeat(64)}/1`,
	mediaType: "audio/mpeg",
	durationSeconds: 2820,
});
const MEDIA = { kind: "book" as const, fileName: "talk.mp3", routeId: ReaderArticleHashId.from(PRIVATE_URL).value };

describe("initDynamoDbPrivateItemMedia setArticleEnclosure", () => {
	it("sets the enclosure on an owned row that was not purged", async () => {
		const { store, sent } = harness(() => ({}));

		assert.equal(await store.setArticleEnclosure({ url: PRIVATE_URL, enclosure: ENCLOSURE }), "recorded");

		assert.deepEqual(sent, [
			{
				command: "UpdateCommand",
				input: {
					TableName: "articles",
					Key: { url: KEY },
					UpdateExpression: "SET enclosure = :enclosure",
					ConditionExpression: "attribute_exists(ownerUserId) AND attribute_not_exists(purgedAt)",
					ExpressionAttributeValues: { ":enclosure": ENCLOSURE },
				},
			},
		]);
	});

	it("answers not-found when the row is missing or carries purgedAt", async () => {
		const { store } = harness(() => {
			throw new ConditionalCheckFailedException({ $metadata: {}, message: "missing or purged" });
		});

		assert.equal(await store.setArticleEnclosure({ url: PRIVATE_URL, enclosure: ENCLOSURE }), "not-found");
	});

	it("rethrows any other failure", async () => {
		const failure = new Error("throttled");
		const { store } = harness(() => {
			throw failure;
		});

		await assert.rejects(
			store.setArticleEnclosure({ url: PRIVATE_URL, enclosure: ENCLOSURE }),
			(error: unknown) => error === failure,
		);
	});
});

describe("initDynamoDbPrivateItemMedia recordTranscriptOutcome", () => {
	it("sets media.transcript on an owned row that was not purged", async () => {
		const { store, sent } = harness(() => ({}));

		assert.equal(await store.recordTranscriptOutcome({ url: PRIVATE_URL, transcript: "no-speech" }), "recorded");

		assert.deepEqual(sent, [
			{
				command: "UpdateCommand",
				input: {
					TableName: "articles",
					Key: { url: KEY },
					UpdateExpression: "SET media.transcript = :transcript",
					ConditionExpression: "attribute_exists(ownerUserId) AND attribute_not_exists(purgedAt)",
					ExpressionAttributeValues: { ":transcript": "no-speech" },
				},
			},
		]);
	});

	it("answers not-found when the row is missing or carries purgedAt", async () => {
		const { store } = harness(() => {
			throw new ConditionalCheckFailedException({ $metadata: {}, message: "missing or purged" });
		});

		assert.equal(
			await store.recordTranscriptOutcome({ url: PRIVATE_URL, transcript: "transcript-failed" }),
			"not-found",
		);
	});
});

describe("initDynamoDbPrivateItemMedia findArticleMedia", () => {
	it("reads the row's media and enclosure with a consistent read", async () => {
		const { store, sent } = harness(() => ({ Item: { media: MEDIA, enclosure: ENCLOSURE } }));

		assert.deepEqual(await store.findArticleMedia({ url: PRIVATE_URL }), {
			media: ItemMediaSchema.parse(MEDIA),
			enclosure: ENCLOSURE,
		});
		assert.deepEqual(sent, [
			{
				command: "GetCommand",
				input: {
					TableName: "articles",
					Key: { url: KEY },
					ConsistentRead: true,
					ProjectionExpression: "#media, #enclosure, #purgedAt",
					ExpressionAttributeNames: { "#media": "media", "#enclosure": "enclosure", "#purgedAt": "purgedAt" },
				},
			},
		]);
	});

	it("is undefined for a missing row", async () => {
		const { store } = harness(() => ({}));

		assert.equal(await store.findArticleMedia({ url: PRIVATE_URL }), undefined);
	});

	it("is undefined for a row carrying purgedAt", async () => {
		const { store } = harness(() => ({
			Item: { media: MEDIA, enclosure: ENCLOSURE, purgedAt: "2026-11-05T11:00:00.000Z" },
		}));

		assert.equal(await store.findArticleMedia({ url: PRIVATE_URL }), undefined);
	});
});
