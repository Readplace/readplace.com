import assert from "node:assert/strict";
import type { DynamoDBDocumentClient } from "@packages/storage-client";
import { initDynamoDbAdminAccess } from "./dynamodb-admin-access";

function fakeClient(item?: Record<string, unknown>) {
	const sent: unknown[] = [];
	const client: Partial<DynamoDBDocumentClient> = {
		send: (async (command: { input: unknown }) => {
			sent.push(command.input);
			return item ? { Item: item } : {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as DynamoDBDocumentClient, sent };
}

function accessOver(item?: Record<string, unknown>) {
	const fake = fakeClient(item);
	const access = initDynamoDbAdminAccess({ client: fake.client, usersTableName: "users", sessionsTableName: "sessions" });
	return { ...access, sent: fake.sent };
}

const USER_ID = "f19792f1a14cf1d500de060278ab4bc3";

describe("initDynamoDbAdminAccess findUserByEmail", () => {
	it("reads the users row under the normalised email with the gate's projection", async () => {
		const access = accessOver({ email: "ops@readplace.com", userId: USER_ID, emailVerified: true, registeredAt: "2026-01-01T00:00:00.000Z" });

		const user = await access.findUserByEmail("  OPS@Readplace.com ");

		assert.deepEqual(user, { userId: USER_ID, emailVerified: true, registeredAt: "2026-01-01T00:00:00.000Z" });
		assert.equal(access.sent.length, 1);
		const [input] = access.sent;
		assert.ok(input && typeof input === "object");
		assert.equal(Reflect.get(input, "TableName"), "users");
		assert.deepEqual(Reflect.get(input, "Key"), { email: "ops@readplace.com" });
		assert.match(String(Reflect.get(input, "ProjectionExpression")), /deletedAt/);
	});

	it("reads a row without emailVerified as unverified", async () => {
		const access = accessOver({ email: "ops@readplace.com", userId: USER_ID });

		assert.deepEqual(await access.findUserByEmail("ops@readplace.com"), { userId: USER_ID, emailVerified: false, registeredAt: undefined });
	});

	it("reads a deleted account as absent", async () => {
		const access = accessOver({ email: "ops@readplace.com", userId: USER_ID, emailVerified: true, deletedAt: "2026-02-01T00:00:00.000Z" });

		assert.equal(await access.findUserByEmail("ops@readplace.com"), null);
	});

	it("reads a missing row as absent", async () => {
		assert.equal(await accessOver().findUserByEmail("ops@readplace.com"), null);
	});
});

describe("initDynamoDbAdminAccess findSessionAdminMfaVerifiedAt", () => {
	it("reads the session's second-factor mark with a consistent read", async () => {
		const access = accessOver({ sessionId: "sid", userId: USER_ID, expiresAt: 1_900_000_000, adminMfaVerifiedAt: 1_800_000_000 });

		assert.equal(await access.findSessionAdminMfaVerifiedAt("sid"), 1_800_000_000);
		const [input] = access.sent;
		assert.ok(input && typeof input === "object");
		assert.equal(Reflect.get(input, "TableName"), "sessions");
		assert.deepEqual(Reflect.get(input, "Key"), { sessionId: "sid" });
		assert.equal(Reflect.get(input, "ConsistentRead"), true);
	});

	it("reads a session without a mark, or no session, as unmarked", async () => {
		assert.equal(await accessOver({ sessionId: "sid", userId: USER_ID, expiresAt: 1_900_000_000 }).findSessionAdminMfaVerifiedAt("sid"), undefined);
		assert.equal(await accessOver().findSessionAdminMfaVerifiedAt("sid"), undefined);
	});
});
