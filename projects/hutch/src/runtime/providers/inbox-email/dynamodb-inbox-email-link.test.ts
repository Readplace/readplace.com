import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initDynamoDbInboxEmailLink } from "./dynamodb-inbox-email-link";

type SendFn = DynamoDBDocumentClient["send"];

function createFakeClient(impl: (input: unknown) => unknown): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (input: unknown) => impl(input)) as unknown as SendFn,
	};
}

interface CapturedCommand {
	input: {
		Item?: Record<string, unknown>;
		Key?: Record<string, unknown>;
		KeyConditionExpression?: string;
		ConditionExpression?: string;
		UpdateExpression?: string;
		ScanIndexForward?: boolean;
		ExpressionAttributeValues?: Record<string, unknown>;
		ExpressionAttributeNames?: Record<string, string>;
	};
}

const TABLE = "test-inbox-email-links";
const USER = UserIdSchema.parse("user-1");
const RAM = "2026-06-23T00:00:00.000Z#<m-1@example.com>";
const GROUP = `${USER}#${RAM}`;
const ORDINAL = EmailLinkOrdinalSchema.parse("0003");

function conditionalCheckFailed(): ConditionalCheckFailedException {
	return new ConditionalCheckFailedException({ $metadata: {}, message: "exists" });
}

function store(impl: (input: unknown) => unknown) {
	return initDynamoDbInboxEmailLink({
		client: createFakeClient(impl) as DynamoDBDocumentClient,
		tableName: TABLE,
	});
}

describe("initDynamoDbInboxEmailLink", () => {
	describe("putLink", () => {
		it("conditionally puts a pending row keyed for idempotency, omitting preview fields", async () => {
			let captured: CapturedCommand | undefined;
			const result = await store((cmd) => {
				captured = cmd as CapturedCommand;
				return {};
			}).putLink({
				userId: USER,
				receivedAtMessageId: RAM,
				ordinal: ORDINAL,
				url: "https://example.com/post",
				status: "pending",
				title: undefined,
				excerpt: undefined,
				siteName: undefined,
				imageUrl: undefined,
				failureReason: undefined,
			});

			expect(result).toBe("stored");
			expect(captured?.input.ConditionExpression).toBe("attribute_not_exists(ordinal)");
			expect(captured?.input.Item?.userLinkGroup).toBe(GROUP);
			expect(captured?.input.Item?.ordinal).toBe("0003");
			expect(captured?.input.Item?.url).toBe("https://example.com/post");
			expect(captured?.input.Item?.status).toBe("pending");
			expect(captured?.input.Item).not.toHaveProperty("title");
		});

		it("returns duplicate when the conditional put fails on an existing row", async () => {
			const result = await store(() => {
				throw conditionalCheckFailed();
			}).putLink({
				userId: USER,
				receivedAtMessageId: RAM,
				ordinal: ORDINAL,
				url: "https://example.com/post",
				status: "pending",
				title: undefined,
				excerpt: undefined,
				siteName: undefined,
				imageUrl: undefined,
				failureReason: undefined,
			});

			expect(result).toBe("duplicate");
		});

		it("rethrows errors that are not conditional-check failures", async () => {
			await expect(
				store(() => {
					throw new Error("throttled");
				}).putLink({
					userId: USER,
					receivedAtMessageId: RAM,
					ordinal: ORDINAL,
					url: "https://example.com/post",
					status: "pending",
					title: undefined,
					excerpt: undefined,
					siteName: undefined,
					imageUrl: undefined,
					failureReason: undefined,
				}),
			).rejects.toThrow("throttled");
		});
	});

	describe("setLinkOutcome", () => {
		it("sets the crawled preview fields including a lead image", async () => {
			let captured: CapturedCommand | undefined;
			await store((cmd) => {
				captured = cmd as CapturedCommand;
				return {};
			}).setLinkOutcome({
				userId: USER,
				receivedAtMessageId: RAM,
				ordinal: ORDINAL,
				outcome: {
					status: "crawled",
					title: "T",
					excerpt: "E",
					siteName: "S",
					imageUrl: "https://cdn.test/x.jpg",
				},
			});

			expect(captured?.input.Key).toEqual({ userLinkGroup: GROUP, ordinal: "0003" });
			expect(captured?.input.UpdateExpression).toContain("#imageUrl = :imageUrl");
			expect(captured?.input.UpdateExpression).toContain("REMOVE #failureReason");
			expect(captured?.input.ExpressionAttributeValues?.[":status"]).toBe("crawled");
			expect(captured?.input.ExpressionAttributeValues?.[":imageUrl"]).toBe("https://cdn.test/x.jpg");
		});

		it("removes the image attribute when a crawl yields no lead image", async () => {
			let captured: CapturedCommand | undefined;
			await store((cmd) => {
				captured = cmd as CapturedCommand;
				return {};
			}).setLinkOutcome({
				userId: USER,
				receivedAtMessageId: RAM,
				ordinal: ORDINAL,
				outcome: { status: "crawled", title: "T", excerpt: "E", siteName: "S", imageUrl: undefined },
			});

			expect(captured?.input.UpdateExpression).toContain("REMOVE #failureReason, #imageUrl");
			expect(captured?.input.ExpressionAttributeValues).not.toHaveProperty(":imageUrl");
		});

		it("sets the failure reason and removes preview fields on a failed outcome", async () => {
			let captured: CapturedCommand | undefined;
			await store((cmd) => {
				captured = cmd as CapturedCommand;
				return {};
			}).setLinkOutcome({
				userId: USER,
				receivedAtMessageId: RAM,
				ordinal: ORDINAL,
				outcome: { status: "failed", failureReason: "unsafe-url" },
			});

			expect(captured?.input.UpdateExpression).toBe(
				"SET #status = :status, #failureReason = :failureReason REMOVE #title, #excerpt, #siteName, #imageUrl",
			);
			expect(captured?.input.ExpressionAttributeValues?.[":failureReason"]).toBe("unsafe-url");
		});
	});

	describe("putLinksMeta", () => {
		it("writes the truncated meta item under the reserved sort key", async () => {
			let captured: CapturedCommand | undefined;
			await store((cmd) => {
				captured = cmd as CapturedCommand;
				return {};
			}).putLinksMeta({ userId: USER, receivedAtMessageId: RAM, meta: { truncated: true } });

			expect(captured?.input.Item?.userLinkGroup).toBe(GROUP);
			expect(captured?.input.Item?.ordinal).toBe("meta");
			expect(captured?.input.Item?.truncated).toBe(true);
		});
	});

	describe("listLinksByEmail", () => {
		it("queries the partition ascending and splits the meta item out of the links", async () => {
			let captured: CapturedCommand | undefined;
			const { links, meta } = await store((cmd) => {
				captured = cmd as CapturedCommand;
				return {
					Items: [
						{
							userLinkGroup: GROUP,
							ordinal: "0000",
							userId: USER,
							receivedAtMessageId: RAM,
							url: "https://a.test",
							status: "crawled",
							title: "A",
							excerpt: "ae",
							siteName: "A site",
							imageUrl: "https://cdn.test/a.jpg",
						},
						{
							userLinkGroup: GROUP,
							ordinal: "0001",
							userId: USER,
							receivedAtMessageId: RAM,
							url: "https://b.test",
							status: "pending",
						},
						{
							userLinkGroup: GROUP,
							ordinal: "meta",
							userId: USER,
							receivedAtMessageId: RAM,
							truncated: true,
						},
					],
					Count: 3,
				};
			}).listLinksByEmail({ userId: USER, receivedAtMessageId: RAM });

			expect(captured?.input.KeyConditionExpression).toBe("userLinkGroup = :pk");
			expect(captured?.input.ExpressionAttributeValues?.[":pk"]).toBe(GROUP);
			expect(captured?.input.ScanIndexForward).toBe(true);
			expect(links.map((l) => l.ordinal)).toEqual(["0000", "0001"]);
			expect(links[0].title).toBe("A");
			expect(links[1].status).toBe("pending");
			expect(meta).toEqual({ truncated: true });
		});

		it("returns no meta when the partition holds only link rows", async () => {
			const { links, meta } = await store(() => ({
				Items: [
					{
						userLinkGroup: GROUP,
						ordinal: "0000",
						userId: USER,
						receivedAtMessageId: RAM,
						url: "https://a.test",
						status: "pending",
					},
				],
				Count: 1,
			})).listLinksByEmail({ userId: USER, receivedAtMessageId: RAM });

			expect(links).toHaveLength(1);
			expect(meta).toBeUndefined();
		});
	});

	describe("getLink", () => {
		it("gets a single link by its composite key", async () => {
			let captured: CapturedCommand | undefined;
			const found = await store((cmd) => {
				captured = cmd as CapturedCommand;
				return {
					Item: {
						userLinkGroup: GROUP,
						ordinal: "0003",
						userId: USER,
						receivedAtMessageId: RAM,
						url: "https://example.com/post",
						status: "crawled",
						title: "Title",
						excerpt: "Excerpt",
						siteName: "Site",
					},
				};
			}).getLink({ userId: USER, receivedAtMessageId: RAM, ordinal: ORDINAL });

			expect(captured?.input.Key).toEqual({ userLinkGroup: GROUP, ordinal: "0003" });
			assert(found, "expected the link to be returned");
			expect(found.title).toBe("Title");
			expect(found.imageUrl).toBeUndefined();
		});

		it("returns undefined for an unknown link", async () => {
			const found = await store(() => ({})).getLink({
				userId: USER,
				receivedAtMessageId: RAM,
				ordinal: ORDINAL,
			});

			expect(found).toBeUndefined();
		});
	});
});
