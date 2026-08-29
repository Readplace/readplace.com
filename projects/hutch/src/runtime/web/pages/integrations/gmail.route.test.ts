import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { InboxAddressSchema } from "@packages/domain/inbox";
import { GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const GMAIL = "/integrations/gmail";
const VERIFY = "/integrations/gmail/verify";
const ADD = "/integrations/gmail/senders/add";
const REMOVE = "/integrations/gmail/senders/remove";
const MAP = "/integrations/gmail/senders/map";
const DISCONNECT = "/integrations/gmail/disconnect";
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");

function load(text: string): Document {
	return new JSDOM(text).window.document;
}

function harnessWithGmail() {
	const gmail = initInMemoryGmailIntegration({
		grant: {
			ok: true,
			grant: {
				refreshToken: "refresh-value",
				accessToken: "access-value",
				grantedScope: GMAIL_SETTINGS_SCOPE,
			},
		},
	});
	const harness = useApp({
		...createDefaultTestAppFixture(TEST_APP_ORIGIN),
		gmailIntegration: gmail.bundle,
	});
	return { harness, gmail };
}

async function connectedAgent(options: { confirmed?: boolean } = {}) {
	const { harness, gmail } = harnessWithGmail();
	const created = await harness.auth.createUser({
		email: "reader@example.com",
		password: "password123",
	});
	assert(created.ok, "the test user is created before the agent signs in");
	const userId = created.userId;
	const agent = request.agent(harness.server);
	await agent
		.post("/login")
		.type("form")
		.send({ email: "reader@example.com", password: "password123" });
	await gmail.bundle.gmailConnectionStore.createConnection({
		userId,
		gatewayAddress: GATEWAY,
	});
	if (options.confirmed !== false) {
		await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
	}
	return { harness, gmail, agent, userId };
}

describe("GET /integrations/gmail", () => {
	it("sends an anonymous reader to the login page", async () => {
		const { harness } = harnessWithGmail();

		const response = await request(harness.server).get(GMAIL);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("sends a reader with no connection back to the integrations list", async () => {
		const { harness } = harnessWithGmail();
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(GMAIL);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations");
	});

	it("shows step 2 with the address to paste into Gmail", async () => {
		const { agent } = await connectedAgent({ confirmed: false });

		const doc = load((await agent.get(GMAIL)).text);

		const step = doc.querySelector("[data-test-gmail-step]");
		assert(step, "the step panel is always rendered");
		assert.equal(step.classList.contains("gmail__step--visible"), true);
		const address = doc.querySelector("[data-test-gmail-address]");
		assert(address, "the gateway address is always rendered");
		assert.equal(address.textContent, GATEWAY);
		const disconnect = doc.querySelector(`form[action="${DISCONNECT}"]`);
		assert(disconnect, "disconnect is reachable while awaiting confirmation");
		const disconnectParent = disconnect.parentElement;
		assert(disconnectParent, "the disconnect form sits directly in the page container");
		assert.equal(disconnectParent.classList.contains("gmail__container"), true);
		const back = doc.querySelector("a.gmail__back");
		assert(back, "the page links back to the integrations list");
		assert.equal(back.getAttribute("href"), "/integrations");
	});

	it("shows the sender list once the address is confirmed", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });

		const doc = load((await agent.get(GMAIL)).text);

		const senders = Array.from(doc.querySelectorAll("[data-test-gmail-sender]")).map((el) =>
			el.getAttribute("data-test-gmail-sender"),
		);
		expect(senders).toEqual([TLDR]);
	});

	it("renders a flash message off the query string", async () => {
		const { agent } = await connectedAgent();

		const doc = load((await agent.get(`${GMAIL}?notice=sender_added`)).text);

		const notice = doc.querySelector("[data-test-gmail-notice-key='sender_added']");
		assert(notice, "a known notice renders");
	});

	it("greets a fresh connection with the connected notice", async () => {
		const { agent } = await connectedAgent({ confirmed: false });

		const doc = load((await agent.get(`${GMAIL}?notice=connected`)).text);

		const notice = doc.querySelector("[data-test-gmail-notice-key='connected']");
		assert(notice, "the connected notice renders after the callback lands here");
	});
});

describe("POST /integrations/gmail/verify", () => {
	it("asks for the filter to be written and says the check started", async () => {
		const { agent, gmail } = await connectedAgent();

		const response = await agent.post(VERIFY).send();

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations/gmail?notice=verifying");
		assert.deepEqual(
			gmail.rewriteRequests.map((request) => request.reason),
			["requested"],
		);
	});
});

describe("POST /integrations/gmail/senders/add", () => {
	it("puts the sender on the filter and asks for a rewrite", async () => {
		const { agent, gmail, userId } = await connectedAgent();

		const response = await agent.post(ADD).type("form").send({ sender: " Dan@TLDR.tech " });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations/gmail?notice=sender_added");
		const sender = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert(sender?.addedToFilterAt, "the sender is on the filter");
		assert.deepEqual(
			gmail.rewriteRequests.map((request) => request.reason),
			["sender-added"],
		);
	});

	it("refuses something that is not an address", async () => {
		const { agent, gmail } = await connectedAgent();

		const response = await agent.post(ADD).type("form").send({ sender: "not an address" });

		expect(response.headers.location).toBe(
			"/integrations/gmail?error=sender_invalid",
		);
		assert.deepEqual(gmail.rewriteRequests, []);
	});

	it("refuses a body with no sender at all", async () => {
		const { agent } = await connectedAgent();

		const response = await agent.post(ADD).type("form").send({});

		expect(response.headers.location).toBe(
			"/integrations/gmail?error=sender_invalid",
		);
	});

	it("refuses a sender that is already on the filter", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });

		const response = await agent.post(ADD).type("form").send({ sender: TLDR });

		expect(response.headers.location).toBe(
			"/integrations/gmail?error=sender_duplicate",
		);
	});

	it("accepts a sender that has only been seen so far", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.recordSenderSeen({
			userId,
			senderEmail: TLDR,
			subject: "TLDR",
		});

		const response = await agent.post(ADD).type("form").send({ sender: TLDR });

		expect(response.headers.location).toBe("/integrations/gmail?notice=sender_added");
	});
});

describe("POST /integrations/gmail/senders/remove", () => {
	it("takes the sender off the filter and asks for a rewrite", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });

		const response = await agent.post(REMOVE).type("form").send({ sender: TLDR });

		expect(response.headers.location).toBe(
			"/integrations/gmail?notice=sender_removed",
		);
		assert.equal(
			await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR }),
			undefined,
		);
		assert.deepEqual(
			gmail.rewriteRequests.map((request) => request.reason),
			["sender-removed"],
		);
	});

	it("refuses something that is not an address", async () => {
		const { agent } = await connectedAgent();

		const response = await agent.post(REMOVE).type("form").send({ sender: "nope" });

		expect(response.headers.location).toBe(
			"/integrations/gmail?error=sender_invalid",
		);
	});
});

describe("POST /integrations/gmail/senders/map", () => {
	it("gives the sender its own alias and puts it on the filter", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.recordSenderSeen({
			userId,
			senderEmail: TLDR,
			subject: "TLDR",
		});

		const response = await agent.post(MAP).type("form").send({ sender: TLDR });

		expect(response.headers.location).toBe(
			"/integrations/gmail?notice=sender_mapped",
		);
		const sender = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert.match(String(sender?.mappedAddress), /^tldr-[0-9a-z]{6}@read\.place$/);
		assert(sender?.addedToFilterAt, "mapping also starts forwarding it");
	});

	it("refuses a sender it has never seen", async () => {
		const { agent } = await connectedAgent();

		const response = await agent.post(MAP).type("form").send({ sender: TLDR });

		expect(response.headers.location).toBe(
			"/integrations/gmail?error=sender_unknown",
		);
	});

	it("refuses something that is not an address", async () => {
		const { agent } = await connectedAgent();

		const response = await agent.post(MAP).type("form").send({ sender: "nope" });

		expect(response.headers.location).toBe(
			"/integrations/gmail?error=sender_invalid",
		);
	});
});

describe("POST /integrations/gmail/disconnect", () => {
	it("hands the teardown to the worker and returns to the integrations list", async () => {
		const { agent, gmail, userId } = await connectedAgent();

		const response = await agent.post(DISCONNECT).send();

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations");
		assert.deepEqual(gmail.disconnectRequests, [{ userId }]);
	});
});
