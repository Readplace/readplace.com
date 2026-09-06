import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ForwardableSenderSchema } from "@packages/domain/gmail";
import { GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const GMAIL = "/integrations/gmail";
const STATUS = "/integrations/gmail/status";
const ADD = "/integrations/gmail/senders/add?utm_source=integrations-gmail&utm_medium=internal&utm_content=add-sender";
const REMOVE = "/integrations/gmail/senders/remove?utm_source=integrations-gmail&utm_medium=internal&utm_content=remove-sender";
const MAP = "/integrations/gmail/senders/map?utm_source=integrations-gmail&utm_medium=internal&utm_content=map-sender";
const DISCONNECT = "/integrations/gmail/disconnect?utm_source=integrations-gmail&utm_medium=internal&utm_content=disconnect";
const CONNECT = "/integrations/gmail/connect?utm_source=integrations-gmail&utm_medium=internal&utm_content=reconnect";
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const MORNING = ForwardableSenderSchema.parse("crew@morningbrew.com");

const BOOST = {
	"hx-boost": "true",
	"hx-target": "main",
	"hx-select": "main",
	"hx-swap": "outerHTML show:none",
};

function load(text: string): Document {
	return new JSDOM(text).window.document;
}

function sections(doc: Document): string[] {
	const present: string[] = [];
	if (doc.querySelector("[data-test-gmail-step]")) present.push("step");
	if (doc.querySelector("[data-test-gmail-senders]")) present.push("senders");
	if (doc.querySelector("[data-test-gmail-reconnect]")) present.push("reconnect");
	return present;
}

function assertBoosted(form: Element | null): void {
	assert(form, "the mutation form is rendered");
	for (const [attr, value] of Object.entries(BOOST)) {
		assert.equal(form.getAttribute(attr), value, `form must carry ${attr}="${value}"`);
	}
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
	const gatewayAddress = await gmail.bundle.mintGatewayAddress({ userId });
	await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
	if (options.confirmed !== false) {
		await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
	}
	return { harness, gmail, agent, userId, gatewayAddress };
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

	it("shows only step 2 with the address to paste into Gmail", async () => {
		const { agent, gatewayAddress } = await connectedAgent({ confirmed: false });

		const doc = load((await agent.get(GMAIL)).text);

		expect(sections(doc)).toEqual(["step"]);
		const address = doc.querySelector("[data-test-gmail-address]");
		assert(address, "the gateway address is always rendered");
		assert.equal(address.textContent, gatewayAddress);
		const disconnect = doc.querySelector(`form[action="${DISCONNECT}"]`);
		assert(disconnect, "disconnect is reachable while awaiting confirmation");
		const disconnectParent = disconnect.parentElement;
		assert(disconnectParent, "the disconnect form sits directly in the page container");
		assert.equal(disconnectParent.classList.contains("gmail__container"), true);
		const back = doc.querySelector("a.gmail__back");
		assert(back, "the page links back to the integrations list");
		assert.equal(
			back.getAttribute("href"),
			"/integrations?utm_source=integrations-gmail&utm_medium=internal&utm_content=back-to-integrations",
		);
	});

	it("polls the status route for a self-updating confirmation while awaiting", async () => {
		const { agent } = await connectedAgent({ confirmed: false });

		const doc = load((await agent.get(GMAIL)).text);

		const poll = doc.querySelector("[data-test-gmail-poll]");
		assert(poll, "the awaiting page carries a poll line");
		assert.equal(poll.getAttribute("hx-get"), `${STATUS}?poll=1`);
		assert.equal(poll.getAttribute("hx-trigger"), "every 3s");
		assert.equal(poll.getAttribute("hx-target"), "this");
		assert.equal(poll.getAttribute("hx-swap"), "outerHTML");
		assert.equal(poll.getAttribute("hx-select"), ".gmail__poll");
	});

	it("does not poll once forwarding is confirmed", async () => {
		const { agent } = await connectedAgent();

		const doc = load((await agent.get(GMAIL)).text);

		assert.equal(doc.querySelector("[data-test-gmail-poll]"), null);
	});

	it("stops handing out a gateway address that has been switched off", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent({ confirmed: false });
		await gmail.addresses.disableAddress({ userId, address: gatewayAddress });

		const doc = load((await agent.get(GMAIL)).text);

		expect(sections(doc)).toEqual([]);
		const alerts = Array.from(doc.querySelectorAll("[data-test-gmail-alert]")).map((el) =>
			el.getAttribute("data-test-gmail-alert-key"),
		);
		expect(alerts).toEqual(["gateway_disabled"]);
	});

	it("boosts the awaiting-state mutations so they swap in place", async () => {
		const { agent } = await connectedAgent({ confirmed: false });

		const doc = load((await agent.get(GMAIL)).text);

		assertBoosted(doc.querySelector(`form[action="${DISCONNECT}"]`));
	});

	it("boosts the sender mutations once the address is confirmed", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		await gmail.bundle.gmailSenderStore.recordSenderSeen({
			userId,
			senderEmail: MORNING,
			subject: "Morning Brew",
		});

		const doc = load((await agent.get(GMAIL)).text);

		assertBoosted(doc.querySelector(`form[action="${ADD}"]`));
		assertBoosted(doc.querySelector(`form[action="${REMOVE}"]`));
		assertBoosted(doc.querySelector(`form[action="${MAP}"]`));
		assertBoosted(doc.querySelector(`form[action="${DISCONNECT}"]`));
	});

	it("boosts the reconnect once Google ends the grant", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });

		const doc = load((await agent.get(GMAIL)).text);

		expect(sections(doc)).toEqual(["reconnect"]);
		assertBoosted(doc.querySelector(`form[action="${CONNECT}"]`));
	});

	it("invites the first sender when none are forwarded yet", async () => {
		const { agent } = await connectedAgent();

		const doc = load((await agent.get(GMAIL)).text);

		expect(sections(doc)).toEqual(["senders"]);
		const empty = doc.querySelector("[data-test-gmail-empty]");
		assert(empty, "the empty state invites the first sender");
		assert.equal(doc.querySelector("[data-test-gmail-sender-list]"), null);
	});

	it("targets the rendered copy button with the selector its built bundle wires", async () => {
		const bundleSource = readFileSync(
			join(__dirname, "..", "..", "client-dist", "integrations.client.js"),
			"utf-8",
		);
		const copySelector = bundleSource.match(/copySelector:\s*'([^']+)'/)?.[1];
		const textAttr = bundleSource.match(/textAttr:\s*'([^']+)'/)?.[1];
		assert(copySelector, "the integrations bundle footer must wire a copySelector");
		assert(textAttr, "the integrations bundle footer must wire a textAttr");
		const { agent } = await connectedAgent({ confirmed: false });

		const response = await agent.get(GMAIL);
		const doc = load(response.text);

		const targeted = Array.from(doc.querySelectorAll(copySelector));
		expect(targeted.length).toBeGreaterThan(0);
		for (const button of targeted) {
			assert(button.hasAttribute(textAttr), `copy button must carry ${textAttr}`);
			assert(button.hasAttribute("hidden"), "the copy button stays hidden until the script reveals it");
		}
		expect(response.text).toContain("/client-dist/integrations.client.js");
	});

	it("serves only the awaiting content to a markdown reader while awaiting", async () => {
		const { agent, gatewayAddress } = await connectedAgent({ confirmed: false });

		const response = await agent.get(GMAIL).set("Accept", "text/markdown");

		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text).toContain("Add the forwarding address");
		expect(response.text).toContain(gatewayAddress);
		expect(response.text).not.toContain("Newsletters you forward");
	});

	it("serves only the sender content to a markdown reader once confirmed", async () => {
		const { agent } = await connectedAgent();

		const response = await agent.get(GMAIL).set("Accept", "text/markdown");

		expect(response.text).toContain("Newsletters you forward");
		expect(response.text).not.toContain("Add the forwarding address");
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

describe("GET /integrations/gmail/status", () => {
	it("keeps a still-awaiting poll ticking with the next cursor", async () => {
		const { agent } = await connectedAgent({ confirmed: false });

		const response = await agent.get(`${STATUS}?poll=3`);

		expect(response.status).toBe(200);
		const poll = load(response.text).querySelector("[data-test-gmail-poll]");
		assert(poll, "the status fragment is a poll line");
		assert.equal(poll.getAttribute("hx-get"), `${STATUS}?poll=4`);
	});

	it("stops a stalled poll and drops the trigger at the confirmation budget", async () => {
		const { agent } = await connectedAgent({ confirmed: false });

		const response = await agent.get(`${STATUS}?poll=100`);

		const poll = load(response.text).querySelector("[data-test-gmail-poll]");
		assert(poll, "the stalled fragment still renders a line");
		assert.equal(poll.getAttribute("hx-get"), null);
	});

	it("full-navigates a polling htmx client once forwarding is confirmed", async () => {
		const { agent } = await connectedAgent();

		const response = await agent.get(`${STATUS}?poll=1`).set("HX-Request", "true");

		expect(response.status).toBe(200);
		expect(response.headers["hx-redirect"]).toBe("/integrations/gmail?notice=confirmed");
		expect(response.headers.location).toBeUndefined();
	});

	it("redirects a plain confirmed poll to the confirmed page", async () => {
		const { agent } = await connectedAgent();

		const response = await agent.get(`${STATUS}?poll=1`);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations/gmail?notice=confirmed");
	});

	it("sends a poller whose connection has vanished back to the integrations list", async () => {
		const { harness } = harnessWithGmail();
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get(`${STATUS}?poll=1`);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations");
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
