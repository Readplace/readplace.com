import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initGetSessionUserId } from "./get-session-user-id";

/** Returns the given row as the GetItem result, or an empty result (no Item)
 * when `row` is undefined — mirroring DynamoDB's miss. */
function createFakeClient(row?: Record<string, unknown>): DynamoDBDocumentClient {
	const client: Partial<DynamoDBDocumentClient> = {
		send: (async () => (row ? { Item: row } : {})) as DynamoDBDocumentClient["send"],
	};
	return client as DynamoDBDocumentClient;
}

function initWith(row?: Record<string, unknown>) {
	return initGetSessionUserId({
		client: createFakeClient(row),
		sessionsTableName: "sessions",
	});
}

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 3600;

describe("initGetSessionUserId", () => {
	it("returns the principal for a live session row", async () => {
		const getSessionUserId = initWith({
			sessionId: "sid",
			userId: "user-1",
			expiresAt: FUTURE,
			emailVerified: true,
		});

		expect(await getSessionUserId("sid")).toEqual({ userId: "user-1", emailVerified: true });
	});

	it("treats a missing emailVerified attribute as not verified", async () => {
		const getSessionUserId = initWith({
			sessionId: "sid",
			userId: "user-1",
			expiresAt: FUTURE,
		});

		expect(await getSessionUserId("sid")).toEqual({ userId: "user-1", emailVerified: false });
	});

	it("returns null when no row exists", async () => {
		expect(await initWith()("sid")).toBeNull();
	});

	it("returns null for an expired row even though it is still present", async () => {
		const getSessionUserId = initWith({
			sessionId: "sid",
			userId: "user-1",
			expiresAt: PAST,
			emailVerified: true,
		});

		expect(await getSessionUserId("sid")).toBeNull();
	});
});
