import assert from "node:assert/strict";
import { ForwardableSenderSchema, GMAIL_FILTER_QUERY_MAX_LENGTH } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger } from "@packages/hutch-logger";
import type { GmailFilter, GmailFilters } from "@packages/provider-contracts/gmail-filters";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailFilters } from "@packages/test-fixtures/providers/gmail-filters";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { AliasNameSchema } from "@packages/domain/inbox";
import { initRewriteGmailFilter } from "./rewrite-gmail-filter";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const NOW = new Date("2026-08-27T00:00:00.000Z");

async function makeHarness(options: {
	gmail?: GmailFilters;
	seedFilters?: GmailFilter[];
	connected?: boolean;
	confirmed?: boolean;
	revoked?: boolean;
	onFilter?: readonly (typeof TLDR)[];
} = {}) {
	const gmail = initInMemoryGmailFilters(options.seedFilters);
	const connections = initInMemoryGmailConnection({ now: () => NOW });
	const senders = initInMemoryGmailSender({ now: () => NOW });
	const addresses = initInMemoryInboxAddress({ now: () => NOW });

	if (options.connected !== false) {
		await connections.createConnection({
			userId: USER,
			gatewayAddress: GATEWAY,
		});
		if (options.confirmed !== false) await connections.markForwardingConfirmed({ userId: USER });
		if (options.revoked === true) {
			await connections.markRevoked({ userId: USER, reason: "invalid-grant" });
		}
	}
	for (const sender of options.onFilter ?? [TLDR]) {
		await senders.addSenderToFilter({ userId: USER, senderEmail: sender });
	}

	const logs: { message: string; data: unknown }[] = [];
	const capture = (...args: unknown[]) => {
		logs.push({ message: String(args[0]), data: args[1] });
	};
	const rewrite = initRewriteGmailFilter({
		filters: options.gmail ?? gmail.api,
		connections,
		senders,
		addresses,
		now: () => NOW,
		logger: HutchLogger.from({ info: capture, warn: capture, error: capture, debug: capture }),
	});

	return { rewrite, gmail, connections, senders, addresses, logs };
}

function overCapSender(index: number) {
	return ForwardableSenderSchema.parse(`s${String(index).padStart(4, "0")}@example.com`);
}

function sendersExceedingQueryCap() {
	const perSenderQueryLength = overCapSender(1).length + " OR ".length;
	const count = Math.ceil(GMAIL_FILTER_QUERY_MAX_LENGTH / perSenderQueryLength) + 1;
	return Array.from({ length: count }, (_unused, index) => overCapSender(index + 1));
}

describe("initRewriteGmailFilter", () => {
	it("writes the filter, reads it back, and records it on the connection", async () => {
		const { rewrite, gmail, connections } = await makeHarness({ onFilter: [TLDR, BREW] });

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, { ok: true, filterCount: 1, senderCount: 2 });
		assert.deepEqual(gmail.created, [
			{ query: "from:(crew@morningbrew.com OR dan@tldr.tech)", forwardTo: GATEWAY },
		]);
		const connection = await connections.findConnectionByUserId(USER);
		assert.equal(connection?.filterCount, 1);
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

	it("logs the replaced filter by id without leaking the query or its senders", async () => {
		const { rewrite, logs } = await makeHarness({
			seedFilters: [{ id: "f-old", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY }],
			onFilter: [TLDR, BREW],
		});

		await rewrite({ userId: USER });

		for (const line of logs) {
			const serialized = JSON.stringify(line);
			assert.equal(serialized.includes("from:("), false);
			assert.equal(serialized.includes("dan@tldr.tech"), false);
			assert.equal(serialized.includes("crew@morningbrew.com"), false);
		}
		const replaced = logs.find(
			(line) => line.message === "[rewrite-gmail-filter] replaced filter",
		);
		assert(replaced, "the replacement path logs a replaced-filter line");
		assert.equal(JSON.stringify(replaced.data).includes("f-old"), true);
		assert.equal(JSON.stringify(replaced.data).includes(USER), true);
	});

	it("leaves a filter alone when it already carries the query the senders produce", async () => {
		const { rewrite, gmail, connections } = await makeHarness({
			seedFilters: [{ id: "f-live", query: "from:(dan@tldr.tech)", forwardTo: GATEWAY }],
		});

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, { ok: true, filterCount: 1, senderCount: 1 });
		assert.deepEqual(gmail.created, []);
		assert.deepEqual(gmail.deleted, []);
		assert.equal((await connections.findConnectionByUserId(USER))?.filterCount, 1);
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

		assert.deepEqual(result, { ok: true, filterCount: 0, senderCount: 0 });
		assert.deepEqual(gmail.deleted, ["f-live"]);
		const connection = await connections.findConnectionByUserId(USER);
		assert.equal(connection?.filterCount, undefined);
	});

	it("does not write a filter for a sender only discovered in Gmail", async () => {
		const { rewrite, gmail, senders } = await makeHarness({ onFilter: [] });
		await senders.recordSenderSeen({ userId: USER, senderEmail: TLDR, subject: "Issue 1" });

		assert.deepEqual(await rewrite({ userId: USER }), { ok: true, filterCount: 0, senderCount: 0 });
		assert.deepEqual(gmail.created, []);
	});

	it("refuses to write a query longer than Gmail accepts and says why", async () => {
		const { rewrite, gmail, connections } = await makeHarness({
			onFilter: sendersExceedingQueryCap(),
		});

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, {
			ok: false,
			reason: "query-too-long",
			forwardTo: GATEWAY,
			senderCount: sendersExceedingQueryCap().length,
			senderCapacity: 48,
		});
		assert.deepEqual(gmail.created, []);
		const connection = await connections.findConnectionByUserId(USER);
		assert.deepEqual(connection?.lastFilterError, {
			code: "query-too-long",
			forwardTo: GATEWAY,
			senderCount: sendersExceedingQueryCap().length,
			senderCapacity: 48,
			at: NOW.toISOString(),
		});
	});

	it("deletes the filter Gmail silently rewrote and records the mismatch", async () => {
		const gmail = initInMemoryGmailFilters();
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
		const error = connection?.lastFilterError;
		assert(error?.code === "rejected");
		assert.match(error.message, /from:\(truncated/);
	});

	it("names the missing query when Gmail reads the filter back with none", async () => {
		const gmail = initInMemoryGmailFilters();
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
		const error = connection?.lastFilterError;
		assert(error?.code === "rejected");
		assert.match(error.message, /\(none\)/);
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
		const gmail = initInMemoryGmailFilters();
		const { rewrite, connections } = await makeHarness({
			gmail: { ...gmail.api, listFilters: async () => ({ ok: false, reason: "reauth-required" }) },
		});

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, { ok: false, reason: "reauth-required" });
		assert.equal((await connections.findConnectionByUserId(USER))?.revokedReason, "invalid-grant");
	});

	it("passes a Gmail outage back for redrive without recording an error", async () => {
		const gmail = initInMemoryGmailFilters();
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
		const gmail = initInMemoryGmailFilters();
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
		const error = (await connections.findConnectionByUserId(USER))?.lastFilterError;
		assert(error?.code === "rejected");
		assert.equal(error.message, "Unrecognized forwarding address");
	});

	it("stops when the filter it just wrote cannot be read back", async () => {
		const gmail = initInMemoryGmailFilters();
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
		const gmail = initInMemoryGmailFilters([
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
		const gmail = initInMemoryGmailFilters([
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

	it("forwards every mapped sender through the gateway", async () => {
		const { rewrite, gmail, addresses, senders } = await makeHarness({ onFilter: [TLDR] });
		const tech = await addresses.createAddress({
			userId: USER,
			domain: "read.place",
			name: AliasNameSchema.parse("tech"),
			purpose: "gmail-mapped",
		});
		const news = await addresses.createAddress({
			userId: USER,
			domain: "read.place",
			name: AliasNameSchema.parse("news"),
			purpose: "gmail-mapped",
		});
		await senders.addSenderToFilter({ userId: USER, senderEmail: BREW });
		await senders.mapSenderToAddress({ userId: USER, senderEmail: TLDR, mappedAddress: tech.address });
		await senders.mapSenderToAddress({ userId: USER, senderEmail: BREW, mappedAddress: news.address });

		const result = await rewrite({ userId: USER });

		assert(result.ok);
		assert.equal(result.filterCount, 1);
		assert.equal(result.senderCount, 2);
		assert.deepEqual(gmail.created, [
			{ query: "from:(crew@morningbrew.com OR dan@tldr.tech)", forwardTo: GATEWAY },
		]);
	});

	it("replaces a stale filter that forwards to an owned inbox", async () => {
		const { rewrite, gmail, addresses, senders } = await makeHarness({ onFilter: [TLDR] });
		const tech = await addresses.createAddress({
			userId: USER,
			domain: "read.place",
			name: AliasNameSchema.parse("tech"),
			purpose: "gmail-mapped",
		});
		await senders.mapSenderToAddress({ userId: USER, senderEmail: TLDR, mappedAddress: tech.address });
		gmail.store.set("f-tech", {
			id: "f-tech",
			query: "from:(dan@tldr.tech)",
			forwardTo: tech.address,
		});

		const result = await rewrite({ userId: USER });

		assert.deepEqual(result, { ok: true, filterCount: 1, senderCount: 1 });
		assert.deepEqual(gmail.created, [{ query: "from:(dan@tldr.tech)", forwardTo: GATEWAY }]);
		assert.deepEqual(gmail.deleted, ["f-tech"]);
	});
});
