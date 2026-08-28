import assert from "node:assert/strict";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { GmailFilter, GmailFilters } from "@packages/provider-contracts/gmail-filters";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initRewriteGmailFilter } from "./rewrite-gmail-filter";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const NOW = new Date("2026-08-27T00:00:00.000Z");

function inMemoryGmail(seed: GmailFilter[] = []) {
	const store = new Map(seed.map((filter) => [filter.id, filter]));
	const deleted: string[] = [];
	const created: { query: string; forwardTo: string }[] = [];
	let nextId = 100;

	const api: GmailFilters = {
		listFilters: async () => ({ ok: true, value: [...store.values()] }),
		createForwardingFilter: async ({ query, forwardTo }) => {
			created.push({ query, forwardTo });
			nextId += 1;
			const filter: GmailFilter = { id: `f-${nextId}`, query, forwardTo };
			store.set(filter.id, filter);
			return { ok: true, value: filter };
		},
		getFilter: async ({ filterId }) => {
			const found = store.get(filterId);
			assert(found, "getFilter must be called with an id Gmail knows");
			return { ok: true, value: found };
		},
		deleteFilter: async ({ filterId }) => {
			deleted.push(filterId);
			store.delete(filterId);
			return { ok: true, value: undefined };
		},
	};

	return { store, deleted, created, api };
}

async function makeHarness(options: {
	gmail?: GmailFilters;
	seedFilters?: GmailFilter[];
	connected?: boolean;
	confirmed?: boolean;
	revoked?: boolean;
	onFilter?: readonly (typeof TLDR)[];
} = {}) {
	const gmail = inMemoryGmail(options.seedFilters);
	const connections = initInMemoryGmailConnection({ now: () => NOW });
	const senders = initInMemoryGmailSender({ now: () => NOW });

	if (options.connected !== false) {
		await connections.createConnection({
			userId: USER,
			gatewayAddress: GATEWAY,
			googleAccountEmail: "reader@gmail.com",
		});
		if (options.confirmed !== false) await connections.markForwardingConfirmed({ userId: USER });
		if (options.revoked === true) {
			await connections.markRevoked({ userId: USER, reason: "user-disconnected" });
		}
	}
	for (const sender of options.onFilter ?? [TLDR]) {
		await senders.addSenderToFilter({ userId: USER, senderEmail: sender });
	}

	const rewrite = initRewriteGmailFilter({
		filters: options.gmail ?? gmail.api,
		connections,
		senders,
		now: () => NOW,
		logger: HutchLogger.from(noopLogger),
	});

	return { rewrite, gmail, connections, senders };
}

describe("initRewriteGmailFilter", () => {
	it("writes the filter, reads it back, and records it on the connection", async () => {
		const { rewrite, gmail, connections } = await makeHarness({ onFilter: [TLDR, BREW] });

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, { ok: true, filterId: "f-101", senderCount: 2 });
		assert.deepEqual(gmail.created, [
			{ query: "from:(crew@morningbrew.com OR dan@tldr.tech)", forwardTo: GATEWAY },
		]);
		const connection = await connections.findConnectionByUserId(USER);
		assert.equal(connection?.filterId, "f-101");
		assert.equal(connection?.filterQuery, "from:(crew@morningbrew.com OR dan@tldr.tech)");
		assert.equal(connection?.filterSenderCount, 2);
	});

	it("creates the replacement before deleting the filter it supersedes", async () => {
		const { rewrite, gmail } = await makeHarness({
			seedFilters: [{ id: "f-old", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY }],
			onFilter: [TLDR, BREW],
		});

		await rewrite({ userId: USER });

		assert.deepEqual(gmail.deleted, ["f-old"]);
		assert.deepEqual(
			[...gmail.store.values()].map((filter) => filter.query),
			["from:(crew@morningbrew.com OR dan@tldr.tech)"],
		);
	});

	it("leaves a filter alone when it already carries the query the senders produce", async () => {
		const { rewrite, gmail, connections } = await makeHarness({
			seedFilters: [{ id: "f-live", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY }],
		});

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, { ok: true, filterId: "f-live", senderCount: 1 });
		assert.deepEqual(gmail.created, []);
		assert.deepEqual(gmail.deleted, []);
		assert.equal((await connections.findConnectionByUserId(USER))?.filterId, "f-live");
	});

	it("collapses a duplicate pair back to exactly one filter", async () => {
		const { rewrite, gmail } = await makeHarness({
			seedFilters: [
				{ id: "f-a", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY },
				{ id: "f-b", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY },
			],
		});

		await rewrite({ userId: USER });

		assert.deepEqual(gmail.deleted, ["f-a", "f-b"]);
		assert.equal(gmail.store.size, 1);
	});

	it("never touches a filter that forwards somewhere else", async () => {
		const { rewrite, gmail } = await makeHarness({
			seedFilters: [{ id: "f-theirs", query: "from:(boss@work.com)", forwardTo: "them@work.com" }],
		});

		await rewrite({ userId: USER });

		assert.deepEqual(gmail.deleted, []);
		assert.equal(gmail.store.size, 2);
	});

	it("removes the filter entirely once the last sender is gone", async () => {
		const { rewrite, gmail, connections, senders } = await makeHarness({
			seedFilters: [{ id: "f-live", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY }],
		});
		await senders.removeSender({ userId: USER, senderEmail: TLDR });

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, { ok: true, filterId: undefined, senderCount: 0 });
		assert.deepEqual(gmail.deleted, ["f-live"]);
		const connection = await connections.findConnectionByUserId(USER);
		assert.equal(connection?.filterId, undefined);
		assert.equal(connection?.filterQuery, undefined);
	});

	it("refuses to write a query longer than Gmail accepts and says why", async () => {
		const longSenders = Array.from({ length: 40 }, (_unused, index) =>
			ForwardableSenderSchema.parse(`${"newsletter".repeat(3)}${index}@publisher.example.com`),
		);
		const { rewrite, gmail, connections } = await makeHarness({ onFilter: longSenders });

		const result = await rewrite({ userId: USER });

		assert.equal(result.ok, false);
		assert.equal(result.ok === false && result.reason, "query-too-long");
		assert.deepEqual(gmail.created, []);
		const connection = await connections.findConnectionByUserId(USER);
		assert.equal(connection?.lastFilterError?.code, "query-too-long");
	});

	it("deletes the filter Gmail silently rewrote and records the mismatch", async () => {
		const gmail = inMemoryGmail();
		const { rewrite, connections } = await makeHarness({
			gmail: {
				...gmail.api,
				getFilter: async ({ filterId }) => ({
					ok: true,
					value: { id: filterId, query: "from:(truncated", forwardTo: GATEWAY },
				}),
			},
		});

		const result = await rewrite({ userId: USER });

		assert.equal(result.ok === false && result.reason, "rejected");
		assert.deepEqual(gmail.deleted, ["f-101"]);
		const connection = await connections.findConnectionByUserId(USER);
		assert.equal(connection?.lastFilterError?.code, "rejected");
		assert.match(String(connection?.lastFilterError?.message), /from:\(truncated/);
	});

	it("names the missing query when Gmail reads the filter back with none", async () => {
		const gmail = inMemoryGmail();
		const { rewrite, connections } = await makeHarness({
			gmail: {
				...gmail.api,
				getFilter: async ({ filterId }) => ({
					ok: true,
					value: { id: filterId, query: undefined, forwardTo: GATEWAY },
				}),
			},
		});

		await rewrite({ userId: USER });

		const connection = await connections.findConnectionByUserId(USER);
		assert.match(String(connection?.lastFilterError?.message), /\(none\)/);
	});

	it("reports a user who never connected Gmail", async () => {
		const { rewrite } = await makeHarness({ connected: false });

		assert.deepEqual(await rewrite({ userId: USER }), { ok: false, reason: "not-connected" });
	});

	it("reports a connection whose grant is already gone", async () => {
		const { rewrite } = await makeHarness({ revoked: true });

		assert.deepEqual(await rewrite({ userId: USER }), { ok: false, reason: "reauth-required" });
	});

	it("reports a connection whose forwarding address Google has not confirmed", async () => {
		const { rewrite } = await makeHarness({ confirmed: false });

		assert.deepEqual(await rewrite({ userId: USER }), { ok: false, reason: "not-confirmed" });
	});

	it("marks the connection revoked when Gmail refuses the grant", async () => {
		const gmail = inMemoryGmail();
		const { rewrite, connections } = await makeHarness({
			gmail: { ...gmail.api, listFilters: async () => ({ ok: false, reason: "reauth-required" }) },
		});

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "reauth-required" });
		assert.equal((await connections.findConnectionByUserId(USER))?.revokedReason, "invalid-grant");
	});

	it("passes a Gmail outage back for redrive without recording an error", async () => {
		const gmail = inMemoryGmail();
		const { rewrite, connections } = await makeHarness({
			gmail: {
				...gmail.api,
				listFilters: async () => ({ ok: false, reason: "unavailable", status: 503 }),
			},
		});

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "unavailable", status: 503 });
		assert.equal((await connections.findConnectionByUserId(USER))?.lastFilterError, undefined);
	});

	it("records why Gmail refused to create the filter", async () => {
		const gmail = inMemoryGmail();
		const { rewrite, connections } = await makeHarness({
			gmail: {
				...gmail.api,
				createForwardingFilter: async () => ({
					ok: false,
					reason: "rejected",
					status: 400,
					message: "Unrecognized forwarding address",
				}),
			},
		});

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, {
			ok: false,
			reason: "rejected",
			message: "Unrecognized forwarding address",
		});
		assert.equal(
			(await connections.findConnectionByUserId(USER))?.lastFilterError?.message,
			"Unrecognized forwarding address",
		);
	});

	it("stops when the filter it just wrote cannot be read back", async () => {
		const gmail = inMemoryGmail();
		const { rewrite } = await makeHarness({
			gmail: {
				...gmail.api,
				getFilter: async () => ({ ok: false, reason: "unavailable", status: 500 }),
			},
		});

		assert.deepEqual(await rewrite({ userId: USER }), {
			ok: false,
			reason: "unavailable",
			status: 500,
		});
	});

	it("stops when the superseded filter cannot be deleted", async () => {
		const gmail = inMemoryGmail([
			{ id: "f-old", query: "from:(old@example.com)", forwardTo: GATEWAY },
		]);
		const { rewrite } = await makeHarness({
			gmail: {
				...gmail.api,
				deleteFilter: async () => ({ ok: false, reason: "unavailable", status: 500 }),
			},
		});

		assert.deepEqual(await rewrite({ userId: USER }), {
			ok: false,
			reason: "unavailable",
			status: 500,
		});
	});

	it("stops when the last filter cannot be removed after the last sender goes", async () => {
		const gmail = inMemoryGmail([
			{ id: "f-live", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY },
		]);
		const { rewrite, senders } = await makeHarness({
			gmail: {
				...gmail.api,
				deleteFilter: async () => ({ ok: false, reason: "unavailable", status: 500 }),
			},
		});
		await senders.removeSender({ userId: USER, senderEmail: TLDR });

		assert.deepEqual(await rewrite({ userId: USER }), {
			ok: false,
			reason: "unavailable",
			status: 500,
		});
	});
});
