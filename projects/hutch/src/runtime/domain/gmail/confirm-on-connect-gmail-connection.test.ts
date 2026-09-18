import assert from "node:assert/strict";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import { GMAIL_FORWARDING_ALIAS } from "@packages/domain/inbox";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initConfirmOnConnectGmailConnection } from "./confirm-on-connect-gmail-connection";

const USER = UserIdSchema.parse("user-1");
const NOW = new Date("2026-09-14T00:00:00.000Z");
const CONFIRMED_AT = NOW.toISOString();
const DOMAIN = "read.place";

function harness() {
	const connections = initInMemoryGmailConnection({ now: () => NOW });
	const addresses = initInMemoryInboxAddress({ now: () => NOW });
	const store = initConfirmOnConnectGmailConnection({ connections });
	const mintGateway = async () =>
		(await addresses.createAddress({ userId: USER, domain: DOMAIN, name: GMAIL_FORWARDING_ALIAS, purpose: "gmail-forwarding" })).address;
	return { connections, addresses, store, mintGateway };
}

describe("initConfirmOnConnectGmailConnection", () => {
	it("returns a confirmed connection on create", async () => {
		const h = harness();
		const gatewayAddress = await h.mintGateway();

		const connection = await h.store.createConnection({ userId: USER, gatewayAddress });

		assert.equal(connection.forwardingConfirmedAt, CONFIRMED_AT);
		assert.equal(connection.gatewayAddress, gatewayAddress);
	});

	it("confirms the new connection after a disconnect", async () => {
		const h = harness();
		const gatewayAddress = await h.mintGateway();
		await h.store.createConnection({ userId: USER, gatewayAddress });
		await h.store.deleteConnection(USER);

		const reconnected = await h.store.createConnection({ userId: USER, gatewayAddress });

		assert.equal(reconnected.forwardingConfirmedAt, CONFIRMED_AT);
	});

	it("delegates its other members to the wrapped store", async () => {
		const h = harness();
		const gatewayAddress = await h.mintGateway();
		await h.store.createConnection({ userId: USER, gatewayAddress });

		await h.store.recordAccountEmail({ userId: USER, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") });
		const found = await h.store.findConnectionByUserId(USER);
		assert.equal(found?.accountEmail, "reader@gmail.com");

		await h.store.deleteConnection(USER);
		assert.equal(await h.store.findConnectionByUserId(USER), undefined);
	});
});
