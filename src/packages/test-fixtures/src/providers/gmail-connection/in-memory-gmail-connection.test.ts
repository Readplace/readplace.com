import assert from "node:assert/strict";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailConnection } from "./in-memory-gmail-connection";

const owner = UserIdSchema.parse("00000000000000000000000000000001");
const otherUser = UserIdSchema.parse("00000000000000000000000000000002");
const gateway = InboxAddressSchema.parse("gmail-a7b2c9@read.place");

function connectedStore(now: () => Date = () => new Date("2026-08-27T00:00:00.000Z")) {
	const store = initInMemoryGmailConnection({ now });
	return {
		store,
		connect: () =>
			store.createConnection({
				userId: owner,
				gatewayAddress: gateway,
				googleAccountEmail: "reader@gmail.com",
			}),
	};
}

describe("initInMemoryGmailConnection", () => {
	it("returns the connection it stored for the owner", async () => {
		const { store, connect } = connectedStore();

		const created = await connect();

		assert.deepEqual(await store.findConnectionByUserId(owner), created);
	});

	it("scopes the connection to its owner", async () => {
		const { store, connect } = connectedStore();
		await connect();

		assert.equal(await store.findConnectionByUserId(otherUser), undefined);
	});

	it("keeps the first confirmation timestamp when Google confirms twice", async () => {
		let clock = new Date("2026-08-27T00:00:00.000Z");
		const { store, connect } = connectedStore(() => clock);
		await connect();

		clock = new Date("2026-08-27T00:05:00.000Z");
		await store.markForwardingConfirmed({ userId: owner });
		clock = new Date("2026-08-27T00:09:00.000Z");
		await store.markForwardingConfirmed({ userId: owner });

		const connection = await store.findConnectionByUserId(owner);
		assert.equal(connection?.forwardingConfirmedAt, "2026-08-27T00:05:00.000Z");
	});

	it("ignores a confirmation for a user who never connected", async () => {
		const { store } = connectedStore();

		await store.markForwardingConfirmed({ userId: owner });

		assert.equal(await store.findConnectionByUserId(owner), undefined);
	});

	it("drops back to awaiting confirmation when Google stops recognising the address", async () => {
		const { store, connect } = connectedStore();
		await connect();
		await store.markForwardingConfirmed({ userId: owner });

		await store.clearForwardingConfirmed({ userId: owner });

		const connection = await store.findConnectionByUserId(owner);
		assert.equal(connection?.forwardingConfirmedAt, undefined);
	});

	it("clears the last error when a filter write succeeds", async () => {
		const { store, connect } = connectedStore();
		await connect();
		await store.recordFilterError({
			userId: owner,
			error: { code: "rejected", message: "nope", at: "2026-08-27T00:01:00.000Z" },
		});

		await store.recordFilter({
			userId: owner,
			filterId: "filter-1",
			filterQuery: "from:(dan@tldr.tech)",
			filterSenderCount: 1,
		});

		const connection = await store.findConnectionByUserId(owner);
		assert.equal(connection?.filterId, "filter-1");
		assert.equal(connection?.filterQuery, "from:(dan@tldr.tech)");
		assert.equal(connection?.filterSenderCount, 1);
		assert.equal(connection?.lastFilterError, undefined);
	});

	it("records why the last filter write failed", async () => {
		const { store, connect } = connectedStore();
		await connect();

		await store.recordFilterError({
			userId: owner,
			error: { code: "query-too-long", message: "1200 chars", at: "2026-08-27T00:01:00.000Z" },
		});

		const connection = await store.findConnectionByUserId(owner);
		assert.deepEqual(connection?.lastFilterError, {
			code: "query-too-long",
			message: "1200 chars",
			at: "2026-08-27T00:01:00.000Z",
		});
	});

	it("records why the grant went away", async () => {
		const { store, connect } = connectedStore();
		await connect();

		await store.markRevoked({ userId: owner, reason: "invalid-grant" });

		const connection = await store.findConnectionByUserId(owner);
		assert.equal(connection?.revokedAt, "2026-08-27T00:00:00.000Z");
		assert.equal(connection?.revokedReason, "invalid-grant");
	});

	it("forgets the filter entirely when the last sender goes", async () => {
		const { store, connect } = connectedStore();
		await connect();
		await store.recordFilter({
			userId: owner,
			filterId: "filter-1",
			filterQuery: "from:(dan@tldr.tech)",
			filterSenderCount: 1,
		});

		await store.clearFilter({ userId: owner });

		const connection = await store.findConnectionByUserId(owner);
		assert.equal(connection?.filterId, undefined);
		assert.equal(connection?.filterQuery, undefined);
		assert.equal(connection?.filterSenderCount, undefined);
		assert.equal(connection?.filterUpdatedAt, undefined);
	});

	it("counts a reconnected reader again", async () => {
		const { store, connect } = connectedStore();
		await connect();
		await store.markRevoked({ userId: owner, reason: "invalid-grant" });

		await store.clearRevoked({ userId: owner });

		const connection = await store.findConnectionByUserId(owner);
		assert.equal(connection?.revokedAt, undefined);
		assert.equal(connection?.revokedReason, undefined);
		assert.equal(await store.countConnected(), 1);
	});

	it("forgets the connection on disconnect", async () => {
		const { store, connect } = connectedStore();
		await connect();

		await store.deleteConnection(owner);

		assert.equal(await store.findConnectionByUserId(owner), undefined);
	});

	it("counts only the connections whose grant is still live", async () => {
		const { store, connect } = connectedStore();
		await connect();
		await store.createConnection({
			userId: otherUser,
			gatewayAddress: gateway,
			googleAccountEmail: "other@gmail.com",
		});

		await store.markRevoked({ userId: otherUser, reason: "user-disconnected" });

		assert.equal(await store.countConnected(), 1);
	});
});
