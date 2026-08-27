import assert from "node:assert/strict";
import { InboxAddressSchema } from "../inbox/inbox-address.schema";
import { UserIdSchema } from "../user";
import { gmailConnectionState } from "./gmail-connection-state";
import type { GmailConnection } from "./gmail-connection.types";

function connection(overrides: Partial<GmailConnection> = {}): GmailConnection {
	return {
		userId: UserIdSchema.parse("user-1"),
		gatewayAddress: InboxAddressSchema.parse("gmail-a7b2c9@read.place"),
		googleAccountEmail: "reader@gmail.com",
		connectedAt: "2026-08-24T00:00:00.000Z",
		forwardingConfirmedAt: undefined,
		filterId: undefined,
		filterQuery: undefined,
		filterSenderCount: undefined,
		filterUpdatedAt: undefined,
		lastFilterError: undefined,
		revokedAt: undefined,
		revokedReason: undefined,
		...overrides,
	};
}

describe("gmailConnectionState", () => {
	it("reports disconnected when there is no connection row", () => {
		assert.equal(gmailConnectionState(undefined), "disconnected");
	});

	it("reports revoked before anything else once the grant is gone", () => {
		const state = gmailConnectionState(
			connection({
				revokedAt: "2026-08-24T01:00:00.000Z",
				revokedReason: "invalid-grant",
				forwardingConfirmedAt: "2026-08-24T00:30:00.000Z",
				filterId: "filter-1",
			}),
		);
		assert.equal(state, "revoked");
	});

	it("reports filter-failed when the last rewrite recorded an error", () => {
		const state = gmailConnectionState(
			connection({
				forwardingConfirmedAt: "2026-08-24T00:30:00.000Z",
				lastFilterError: {
					code: "query-too-long",
					message: "too many senders",
					at: "2026-08-24T02:00:00.000Z",
				},
			}),
		);
		assert.equal(state, "filter-failed");
	});

	it("reports awaiting-confirmation until Google confirms the forwarding address", () => {
		assert.equal(gmailConnectionState(connection()), "awaiting-confirmation");
	});

	it("reports ready-to-filter once confirmed but before a filter exists", () => {
		const state = gmailConnectionState(
			connection({ forwardingConfirmedAt: "2026-08-24T00:30:00.000Z" }),
		);
		assert.equal(state, "ready-to-filter");
	});

	it("reports filtering once a filter is live", () => {
		const state = gmailConnectionState(
			connection({
				forwardingConfirmedAt: "2026-08-24T00:30:00.000Z",
				filterId: "filter-1",
				filterQuery: "from:(dan@tldr.tech)",
				filterSenderCount: 1,
			}),
		);
		assert.equal(state, "filtering");
	});
});
