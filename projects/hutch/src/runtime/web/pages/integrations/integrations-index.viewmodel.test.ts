import assert from "node:assert/strict";
import type { GmailConnection } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { GMAIL_CONNECT_PATH } from "./gmail-connect.url";
import { GMAIL_PATH } from "./gmail.url";
import { toIntegrationsIndexViewModel } from "./integrations-index.viewmodel";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");

function connection(overrides: Partial<GmailConnection> = {}): GmailConnection {
	return {
		userId: USER,
		gatewayAddress: GATEWAY,
		connectedAt: "2026-08-27T00:00:00.000Z",
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

function gmailRow(input: Parameters<typeof toIntegrationsIndexViewModel>[0]) {
	const gmail = toIntegrationsIndexViewModel(input).services.find((s) => s.key === "gmail");
	assert(gmail, "the Gmail row is always present");
	return gmail;
}

describe("toIntegrationsIndexViewModel", () => {
	it("lists Gmail as the only service", () => {
		const vm = toIntegrationsIndexViewModel({ connection: undefined });

		assert.deepEqual(
			vm.services.map((s) => s.key),
			["gmail"],
		);
	});

	it("offers Connect while Gmail is not set up", () => {
		const gmail = gmailRow({ connection: undefined });

		assert.equal(gmail.statusKey, "disconnected");
		assert.equal(gmail.statusLabel, "Not set up");
		assert.deepEqual(
			gmail.actions.map((a) => [a.key, a.method, a.href, a.variant]),
			[["connect", "POST", GMAIL_CONNECT_PATH, "primary"]],
		);
	});

	it("sends an unconfirmed connection to step 2 as the pressing action", () => {
		const gmail = gmailRow({ connection: connection() });

		assert.equal(gmail.statusKey, "awaiting-confirmation");
		assert.equal(gmail.statusLabel, "Step 2 of 2");
		assert.deepEqual(
			gmail.actions.map((a) => [a.key, a.method, a.href, a.variant]),
			[["finish-setup", "GET", GMAIL_PATH, "primary"]],
		);
	});

	it("offers a quiet Manage once the connection is healthy", () => {
		const gmail = gmailRow({
			connection: connection({ forwardingConfirmedAt: "2026-08-27T00:05:00.000Z" }),
		});

		assert.equal(gmail.statusKey, "ready-to-filter");
		assert.equal(gmail.statusLabel, "Connected");
		assert.deepEqual(
			gmail.actions.map((a) => [a.key, a.method, a.href, a.variant]),
			[["manage", "GET", GMAIL_PATH, "secondary"]],
		);
	});

	it("keeps Manage quiet while a filter is live", () => {
		const gmail = gmailRow({
			connection: connection({
				forwardingConfirmedAt: "2026-08-27T00:05:00.000Z",
				filterId: "filter-1",
			}),
		});

		assert.equal(gmail.statusKey, "filtering");
		assert.equal(gmail.statusLabel, "Connected");
		assert.deepEqual(
			gmail.actions.map((a) => [a.key, a.method, a.href, a.variant]),
			[["manage", "GET", GMAIL_PATH, "secondary"]],
		);
	});

	it("promotes Manage to the pressing action when the last filter write failed", () => {
		const gmail = gmailRow({
			connection: connection({
				forwardingConfirmedAt: "2026-08-27T00:05:00.000Z",
				lastFilterError: {
					code: "query-too-long",
					message: "too many senders",
					at: "2026-08-27T02:00:00.000Z",
				},
			}),
		});

		assert.equal(gmail.statusKey, "filter-failed");
		assert.equal(gmail.statusLabel, "Needs attention");
		assert.deepEqual(
			gmail.actions.map((a) => [a.key, a.method, a.href, a.variant]),
			[["manage", "GET", GMAIL_PATH, "primary"]],
		);
	});

	it("asks for a reconnect once Google ends the grant", () => {
		const gmail = gmailRow({
			connection: connection({
				revokedAt: "2026-08-27T01:00:00.000Z",
				revokedReason: "invalid-grant",
			}),
		});

		assert.equal(gmail.statusKey, "revoked");
		assert.equal(gmail.statusLabel, "Reconnect needed");
		assert.deepEqual(
			gmail.actions.map((a) => [a.key, a.method, a.href, a.variant]),
			[["reconnect", "POST", GMAIL_CONNECT_PATH, "primary"]],
		);
	});

	it("renders no alert on a plain visit", () => {
		const vm = toIntegrationsIndexViewModel({ connection: undefined });

		assert.deepEqual(vm.alerts, []);
		assert.equal(vm.hasAlert, false);
		assert.equal(vm.alertVisibility, "hidden");
	});

	it("explains each connect failure the callback can redirect with", () => {
		for (const error of [
			"connect_failed",
			"oauth_denied",
			"oauth_state",
			"oauth_scope",
			"oauth_exchange",
		]) {
			const vm = toIntegrationsIndexViewModel({ connection: undefined, error });
			assert.deepEqual(
				vm.alerts.map((a) => a.key),
				[error],
			);
			assert.equal(vm.hasAlert, true);
			assert.equal(vm.alertVisibility, "visible");
		}
	});

	it("ignores an error code it does not recognise rather than rendering an empty alert", () => {
		const vm = toIntegrationsIndexViewModel({ connection: undefined, error: "made-up" });

		assert.deepEqual(vm.alerts, []);
		assert.equal(vm.hasAlert, false);
	});
});
