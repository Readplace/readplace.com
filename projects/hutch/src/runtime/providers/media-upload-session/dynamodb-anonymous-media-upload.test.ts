import assert from "node:assert/strict";
import type { AnyMediaUploadSession } from "@packages/domain";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/storage-client";
import { UploadIdSchema } from "@packages/media-contracts";
import { initInMemoryMediaUploadSessions } from "@packages/test-fixtures/providers/media-upload-session";
import { initDynamoDbAnonymousMediaUpload } from "./dynamodb-anonymous-media-upload";
import { initDynamoDbMediaUploadSessions } from "./dynamodb-media-upload-sessions";

const UPLOAD_ID = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const UNKNOWN_ID = UploadIdSchema.parse("fedcba9876543210fedcba9876543210");
const READER = UserIdSchema.parse("a".repeat(32));
const OTHER = UserIdSchema.parse("b".repeat(32));
const SAVE_ATTEMPT_ID = SaveAttemptIdSchema.parse("attempt-1");
const ETAG = '"etag-1"';
const NOW = new Date("2026-11-06T00:00:00Z");
const FACTS = { kind: "book" as const, title: "Dune", authors: ["Frank Herbert"], sectionTitles: ["Book One", "Book Two"] };
const NOTICE = "This book is protected by DRM, so Readplace can't open it.";

type Stored = Record<string, unknown>;

interface CommandInput {
	Item?: Stored;
	Key?: { uploadId: string };
	UpdateExpression?: string;
	ConditionExpression?: string;
	ExpressionAttributeNames?: Record<string, string>;
	ExpressionAttributeValues?: Stored;
	ReturnValues?: string;
}

function evaluateCondition(expression: string, row: Stored | undefined, input: CommandInput): boolean {
	const name = (token: string) => input.ExpressionAttributeNames?.[token] ?? token;
	const value = (token: string) => input.ExpressionAttributeValues?.[token];
	const clause = (text: string): boolean => {
		if (text.includes(" OR ")) return text.split(" OR ").some(clause);
		const trimmed = text.trim().replace(/^\((.*)\)$/, "$1");
		if (trimmed.includes(" AND ")) return trimmed.split(" AND ").every(clause);
		const exists = /^attribute_(not_)?exists\((\w+)\)$/.exec(trimmed);
		if (exists) return (row?.[String(exists[2])] === undefined) === (exists[1] === "not_");
		const [left, right] = trimmed.split(" = ");
		assert(left && right, `unsupported condition ${trimmed}`);
		return row !== undefined && row[name(left)] === value(right);
	};
	return clause(expression);
}

function applySet(expression: string, row: Stored, input: CommandInput): Stored {
	const updated = { ...row };
	for (const assignment of expression.replace(/^SET /, "").split(", ")) {
		const [left, right] = assignment.split(" = ");
		assert(left && right, `unsupported update ${assignment}`);
		updated[input.ExpressionAttributeNames?.[left] ?? left] = input.ExpressionAttributeValues?.[right];
	}
	return updated;
}

function createFakeTable() {
	const rows = new Map<string, Stored>();
	const send = async (command: { constructor: { name: string }; input: CommandInput }) => {
		const { input } = command;
		const key = String(input.Item?.uploadId ?? input.Key?.uploadId);
		const row = rows.get(key);
		if (input.ConditionExpression && !evaluateCondition(input.ConditionExpression, row, input)) {
			throw new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });
		}
		if (command.constructor.name === "PutCommand") {
			assert(input.Item);
			assert(!Object.values(input.Item).includes(undefined), "the DocumentClient refuses undefined values");
			rows.set(key, input.Item);
			return {};
		}
		if (command.constructor.name === "GetCommand") return row ? { Item: row } : {};
		assert.equal(command.constructor.name, "UpdateCommand");
		assert(row && input.UpdateExpression);
		const updated = applySet(input.UpdateExpression, row, input);
		rows.set(key, updated);
		return input.ReturnValues === "ALL_NEW" ? { Attributes: updated } : {};
	};
	const client: Partial<DynamoDBDocumentClient> = { send: send as DynamoDBDocumentClient["send"] };
	return { rows, client: client as DynamoDBDocumentClient };
}

function dynamoStore() {
	const { rows, client } = createFakeTable();
	const deps = { client, tableName: "test-media-upload-sessions", now: () => NOW };
	return { rows, ...initDynamoDbMediaUploadSessions(deps), ...initDynamoDbAnonymousMediaUpload(deps) };
}

const implementations = [
	{ name: "DynamoDB", init: dynamoStore },
	{ name: "in-memory", init: initInMemoryMediaUploadSessions },
];

describe.each(implementations)("anonymous media upload sessions ($name)", ({ init }) => {
	const session = { uploadId: UPLOAD_ID, kind: "book" as const, fileName: "dune.epub", saveAttemptId: SAVE_ATTEMPT_ID };

	async function guestUpload(stage: "staged" | "inspecting" | "ready") {
		const store = init();
		await store.createAnyMediaUploadSession({ ...session, userId: undefined });
		if (stage === "staged") return store;
		await store.markMediaUploadInspecting({
			uploadId: UPLOAD_ID,
			etag: ETAG,
			kind: "book",
		});
		if (stage === "inspecting") return store;
		await store.recordMediaInspection({ uploadId: UPLOAD_ID, inspection: { verdict: "inspected", facts: FACTS } });
		return store;
	}

	async function statusOf(store: Awaited<ReturnType<typeof guestUpload>>, userId = READER) {
		const found: AnyMediaUploadSession | undefined = await store.findMediaUploadByCapability({ uploadId: UPLOAD_ID, userId });
		return found?.status;
	}

	it("creates a guest session with no owner and a signed-in session with its owner", async () => {
		const store = init();
		const guest = await store.createAnyMediaUploadSession({ ...session, userId: undefined });
		const member = await store.createAnyMediaUploadSession({ ...session, uploadId: UNKNOWN_ID, userId: READER });

		assert.equal(guest.userId, undefined);
		assert.equal(guest.status, "staged");
		assert.equal(member.userId, READER);
		assert.equal((await store.findMediaUploadSession({ uploadId: UNKNOWN_ID, userId: READER }))?.status, "staged");
	});

	it("refuses to create an upload id twice", async () => {
		const store = await guestUpload("staged");

		await assert.rejects(store.createAnyMediaUploadSession({ ...session, userId: undefined }));
	});

	it("moves a guest's staged upload to inspecting with the etag it was given", async () => {
		const store = await guestUpload("staged");

		assert.equal(
			await store.markMediaUploadInspecting({
				uploadId: UPLOAD_ID,
				etag: ETAG,
				kind: "book",
			}),
			"inspecting",
		);

		const found = await store.findMediaUploadByCapability({ uploadId: UPLOAD_ID, userId: undefined });
		assert.equal(found?.status, "inspecting");
		assert.equal(found && found.userId === undefined ? found.etag : undefined, ETAG);
	});

	it("refuses to inspect an upload that is not staged, a signed-in upload, or an unknown one", async () => {
		const inspecting = await guestUpload("inspecting");
		assert.equal(
			await inspecting.markMediaUploadInspecting({
				uploadId: UPLOAD_ID,
				etag: ETAG,
				kind: "book",
			}),
			"not-staged",
		);

		const member = init();
		await member.createAnyMediaUploadSession({ ...session, userId: READER });
		assert.equal(
			await member.markMediaUploadInspecting({
				uploadId: UPLOAD_ID,
				etag: ETAG,
				kind: "book",
			}),
			"not-staged",
		);
		assert.equal(
			await member.markMediaUploadInspecting({
				uploadId: UNKNOWN_ID,
				etag: ETAG,
				kind: "book",
			}),
			"not-staged",
		);
	});

	it("records an inspected book as ready with its facts", async () => {
		const store = await guestUpload("inspecting");

		const outcome = await store.recordMediaInspection({
			uploadId: UPLOAD_ID,
			inspection: { verdict: "inspected", facts: FACTS },
		});

		assert.equal(outcome, "ready");
		const found = await store.findMediaUploadByCapability({ uploadId: UPLOAD_ID, userId: undefined });
		assert.equal(found?.status, "ready");
		assert.deepEqual(found && found.userId === undefined ? found.facts : undefined, FACTS);
	});

	it("records a rejected book with its reason and notice", async () => {
		const store = await guestUpload("inspecting");

		const outcome = await store.recordMediaInspection({
			uploadId: UPLOAD_ID,
			inspection: { verdict: "rejected", reason: "unreadable", notice: NOTICE },
		});

		assert.equal(outcome, "rejected");
		const found = await store.findMediaUploadByCapability({ uploadId: UPLOAD_ID, userId: undefined });
		assert.equal(found?.status, "rejected");
		assert.equal(found && found.userId === undefined ? found.reason : undefined, "unreadable");
		assert.equal(found && found.userId === undefined ? found.notice : undefined, NOTICE);
	});

	it("refuses to record an inspection twice", async () => {
		const store = await guestUpload("ready");

		const outcome = await store.recordMediaInspection({
			uploadId: UPLOAD_ID,
			inspection: { verdict: "rejected", reason: "unreadable", notice: NOTICE },
		});

		assert.equal(outcome, "not-inspecting");
		assert.equal(await statusOf(store), "ready");
	});

	it("lets the same reader claim a ready upload twice, each time with its etag and save attempt", async () => {
		const store = await guestUpload("ready");

		const first = await store.claimMediaUpload({ uploadId: UPLOAD_ID, userId: READER });
		const second = await store.claimMediaUpload({ uploadId: UPLOAD_ID, userId: READER });

		for (const claimed of [first, second]) {
			assert(claimed !== "not-claimable");
			assert.equal(claimed.userId, READER);
			assert.equal(claimed.status, "staged");
			assert.equal(claimed.etag, ETAG);
			assert.equal(claimed.kind, "book");
			assert.equal(claimed.saveAttemptId, SAVE_ATTEMPT_ID);
		}
		assert.equal((await store.findMediaUploadSession({ uploadId: UPLOAD_ID, userId: READER }))?.status, "staged");
	});

	it("refuses a second reader's claim once the first has claimed", async () => {
		const store = await guestUpload("ready");
		await store.claimMediaUpload({ uploadId: UPLOAD_ID, userId: READER });

		assert.equal(await store.claimMediaUpload({ uploadId: UPLOAD_ID, userId: OTHER }), "not-claimable");
	});

	it("refuses to claim a signed-in staged upload that never went through inspection", async () => {
		const store = init();
		await store.createAnyMediaUploadSession({ ...session, userId: READER });

		assert.equal(await store.claimMediaUpload({ uploadId: UPLOAD_ID, userId: READER }), "not-claimable");
	});

	it("refuses to claim an upload still inspecting", async () => {
		const store = await guestUpload("inspecting");

		assert.equal(await store.claimMediaUpload({ uploadId: UPLOAD_ID, userId: READER }), "not-claimable");
	});

	it("shows a guest's upload to any caller and a claimed upload only to its owner", async () => {
		const store = await guestUpload("ready");
		assert.equal(await statusOf(store, OTHER), "ready");
		assert.equal((await store.findMediaUploadByCapability({ uploadId: UPLOAD_ID, userId: undefined }))?.status, "ready");

		await store.claimMediaUpload({ uploadId: UPLOAD_ID, userId: READER });

		assert.equal(await statusOf(store, READER), "staged");
		assert.equal(await statusOf(store, OTHER), undefined);
		assert.equal(await store.findMediaUploadByCapability({ uploadId: UPLOAD_ID, userId: undefined }), undefined);
		assert.equal(await store.findMediaUploadByCapability({ uploadId: UNKNOWN_ID, userId: READER }), undefined);
	});
});

describe("initDynamoDbAnonymousMediaUpload", () => {
	it("writes no owner attribute for a guest and expires the row 24 hours later", async () => {
		const store = dynamoStore();

		await store.createAnyMediaUploadSession({
			uploadId: UPLOAD_ID,
			userId: undefined,
			kind: "book",
			fileName: "dune.epub",
			saveAttemptId: SAVE_ATTEMPT_ID,
		});

		const row = store.rows.get(UPLOAD_ID);
		assert.equal(row && "userId" in row, false);
		assert.equal(row?.expiresAt, NOW.getTime() / 1000 + 24 * 60 * 60);
	});

	it("passes on a store failure that is not a refused condition", async () => {
		const client: Partial<DynamoDBDocumentClient> = {
			send: (async () => {
				throw new Error("throttled");
			}) as DynamoDBDocumentClient["send"],
		};
		const store = initDynamoDbAnonymousMediaUpload({
			client: client as DynamoDBDocumentClient,
			tableName: "test-media-upload-sessions",
			now: () => NOW,
		});

		await assert.rejects(
			store.markMediaUploadInspecting({
				uploadId: UPLOAD_ID,
				etag: ETAG,
				kind: "book",
			}),
			{ message: "throttled" },
		);
	});
});
