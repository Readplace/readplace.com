import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { AliasNameSchema, INBOX_ADDRESS_MAX_PER_USER } from "@packages/domain/inbox";
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

	it("sends a reader whose teardown is already running back to the integrations list", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.markDisconnectRequested({ userId });

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

	it("walks the reader to the forwarding pane through Gmail's own menus", async () => {
		const { agent } = await connectedAgent({ confirmed: false });

		const doc = load((await agent.get(GMAIL)).text);

		const steps = Array.from(doc.querySelectorAll("[data-test-gmail-steps] li")).map((step) =>
			step.textContent?.replace(/\s+/g, " ").trim(),
		);
		expect(steps).toEqual([
			"Open Gmail and click the gear icon",
			"Choose See all settings",
			"Open Forwarding and POP/IMAP",
			"Click Add a forwarding address, paste the address below, then Next and Proceed",
		]);
	});

	it("shows where to click in Gmail beside the steps that need it", async () => {
		const { agent } = await connectedAgent({ confirmed: false });

		const doc = load((await agent.get(GMAIL)).text);

		const shots = Array.from(doc.querySelectorAll("[data-test-gmail-shot]"));
		expect(shots.map((shot) => shot.getAttribute("data-test-gmail-shot"))).toEqual([
			"see-all-settings",
			"add-forwarding-address",
		]);
		for (const shot of shots) {
			assert.equal(shot.getAttribute("loading"), "lazy");
			assert.match(String(shot.getAttribute("src")), /\/screenshots\/gmail-[a-z-]+\.webp$/);
			assert(shot.getAttribute("alt"), "every screenshot describes what it circles");
			assert(shot.getAttribute("width"), "intrinsic width reserves layout before the image lands");
			assert(shot.getAttribute("height"), "intrinsic height reserves layout before the image lands");
		}
	});

	it("points Open Gmail at the connected mailbox", async () => {
		const { agent, gmail, userId } = await connectedAgent({ confirmed: false });
		await gmail.bundle.gmailConnectionStore.recordAccountEmail({
			userId,
			accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
		});

		const doc = load((await agent.get(GMAIL)).text);

		const link = doc.querySelector("[data-test-gmail-open]");
		assert(link, "step 2 offers a link into Gmail");
		assert.equal(
			link.getAttribute("href"),
			"https://mail.google.com/mail/u/0/?authuser=reader%40gmail.com",
		);
	});

	it("keeps the first-account Gmail link when no mailbox was captured", async () => {
		const { agent } = await connectedAgent({ confirmed: false });

		const doc = load((await agent.get(GMAIL)).text);

		const link = doc.querySelector("[data-test-gmail-open]");
		assert(link, "step 2 offers a link into Gmail");
		assert.equal(link.getAttribute("href"), "https://mail.google.com/mail/u/0/");
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

	it("offers the reader's named inboxes as destinations on the add form", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.addresses.createAddress({
			userId,
			domain: "read.place",
			name: AliasNameSchema.parse("tech"),
			purpose: "gmail-mapped",
		});

		const doc = load((await agent.get(GMAIL)).text);

		const options = Array.from(doc.querySelectorAll("[data-test-gmail-destination-option]")).map(
			(el) => el.getAttribute("data-test-gmail-destination-option"),
		);
		assert(options.includes(""), "the default inbox is offered");
		assert(options.includes("new"), "a new inbox is offered");
		assert.equal(
			options.some((value) => value?.startsWith("tech-")),
			true,
		);
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

	it("creates a named inbox and maps the sender to it", async () => {
		const { agent, gmail, userId } = await connectedAgent();

		const response = await agent
			.post(ADD)
			.type("form")
			.send({ sender: TLDR, destination: "new", inbox_name: "tech" });

		expect(response.headers.location).toBe("/integrations/gmail?notice=inbox_created");
		const sender = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert.match(String(sender?.mappedAddress), /^tech-[0-9a-z]{6}@read\.place$/);
		assert(sender?.addedToFilterAt, "the mapped sender is on the filter");
		assert.deepEqual(
			gmail.rewriteRequests.map((request) => request.reason),
			["sender-added"],
		);
	});

	it("names a new inbox after the sender when the name box is left blank", async () => {
		const { agent, gmail, userId } = await connectedAgent();

		const response = await agent
			.post(ADD)
			.type("form")
			.send({ sender: TLDR, destination: "new" });

		expect(response.headers.location).toBe("/integrations/gmail?notice=inbox_created");
		const sender = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert.match(String(sender?.mappedAddress), /^tldr-[0-9a-z]{6}@read\.place$/);
	});

	it("refuses an inbox name that is not a usable alias", async () => {
		const { agent } = await connectedAgent();

		const response = await agent
			.post(ADD)
			.type("form")
			.send({ sender: TLDR, destination: "new", inbox_name: "!!!" });

		expect(response.headers.location).toBe("/integrations/gmail?error=inbox_name_invalid");
	});

	it("refuses a name the reader already uses for an inbox", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.addresses.createAddress({
			userId,
			domain: "read.place",
			name: AliasNameSchema.parse("tech"),
			purpose: "gmail-mapped",
		});

		const response = await agent
			.post(ADD)
			.type("form")
			.send({ sender: TLDR, destination: "new", inbox_name: "tech" });

		expect(response.headers.location).toBe("/integrations/gmail?error=inbox_name_taken");
	});

	it("refuses a new inbox once the reader is at the address cap", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		for (let index = 0; index < INBOX_ADDRESS_MAX_PER_USER; index++) {
			await gmail.addresses.createAddress({
				userId,
				domain: "read.place",
				name: AliasNameSchema.parse(`n${index}`),
				purpose: "gmail-mapped",
			});
		}

		const response = await agent
			.post(ADD)
			.type("form")
			.send({ sender: TLDR, destination: "new", inbox_name: "another" });

		expect(response.headers.location).toBe("/integrations/gmail?error=inbox_limit");
	});

	it("adds a sender to an existing confirmed named inbox", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const inbox = await gmail.addresses.createAddress({
			userId,
			domain: "read.place",
			name: AliasNameSchema.parse("tech"),
			purpose: "gmail-mapped",
		});
		await gmail.addresses.markGmailForwardingConfirmed({ userId, address: inbox.address });

		const response = await agent
			.post(ADD)
			.type("form")
			.send({ sender: TLDR, destination: inbox.address });

		expect(response.headers.location).toBe("/integrations/gmail?notice=sender_mapped");
		const sender = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert.equal(sender?.mappedAddress, inbox.address);
		assert(sender?.addedToFilterAt, "the sender is on the filter");
	});

	it("asks for Gmail setup when adding a sender to an unconfirmed inbox", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const inbox = await gmail.addresses.createAddress({
			userId,
			domain: "read.place",
			name: AliasNameSchema.parse("tech"),
			purpose: "gmail-mapped",
		});

		const response = await agent
			.post(ADD)
			.type("form")
			.send({ sender: TLDR, destination: inbox.address });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations/gmail?notice=inbox_confirmation_required");
		const doc = load((await agent.get(response.headers.location)).text);
		assert.deepEqual(
			Array.from(doc.querySelectorAll("[data-test-gmail-notice]")).map((notice) =>
				notice.getAttribute("data-test-gmail-notice-key"),
			),
			["inbox_confirmation_required"],
		);
		const address = doc.querySelector("[data-test-gmail-sender-mapped]");
		assert(address, "the inbox address is shown for the reader to add in Gmail");
		assert.equal(address.textContent, inbox.address);
		const sender = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert.equal(sender?.mappedAddress, inbox.address);
		assert(sender?.addedToFilterAt, "the sender is ready for the confirmation-triggered rewrite");
	});

	it("refuses a destination that is not one of the reader's inboxes", async () => {
		const { agent } = await connectedAgent();

		const response = await agent
			.post(ADD)
			.type("form")
			.send({ sender: TLDR, destination: "made-up-3f9a2c@read.place" });

		expect(response.headers.location).toBe("/integrations/gmail?error=inbox_name_invalid");
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
	it("gives the sender its own alias and explains the required Gmail setup", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.recordSenderSeen({
			userId,
			senderEmail: TLDR,
			subject: "TLDR",
		});

		const response = await agent.post(MAP).type("form").send({ sender: TLDR });

		expect(response.headers.location).toBe(
			"/integrations/gmail?notice=inbox_created",
		);
		const sender = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert.match(String(sender?.mappedAddress), /^tldr-[0-9a-z]{6}@read\.place$/);
		assert(sender?.addedToFilterAt, "mapping prepares the sender for forwarding after confirmation");
		const doc = load((await agent.get(response.headers.location)).text);
		assert.deepEqual(
			Array.from(doc.querySelectorAll("[data-test-gmail-notice]")).map((notice) =>
				notice.getAttribute("data-test-gmail-notice-key"),
			),
			["inbox_created"],
		);
		const address = doc.querySelector("[data-test-gmail-sender-mapped]");
		assert(address, "the new address is shown for the reader to add in Gmail");
		assert.equal(address.textContent, sender.mappedAddress);
	});

	it("keeps an unsorted sender unchanged and explains when the inbox limit is reached", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.recordSenderSeen({
			userId,
			senderEmail: TLDR,
			subject: "TLDR",
		});
		for (let index = 0; index < INBOX_ADDRESS_MAX_PER_USER; index++) {
			await gmail.addresses.createAddress({
				userId,
				domain: "read.place",
				name: AliasNameSchema.parse(`n${index}`),
				purpose: "gmail-mapped",
			});
		}
		const senderBefore = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });

		const response = await agent.post(MAP).type("form").send({ sender: TLDR });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations/gmail?error=inbox_limit");
		assert.deepEqual(
			await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR }),
			senderBefore,
		);
		assert.deepEqual(gmail.rewriteRequests, []);
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

	it("stops calling Gmail connected on the page the redirect lands on, before the worker has run", async () => {
		const { agent } = await connectedAgent();

		await agent.post(DISCONNECT).send();
		const doc = load((await agent.get("/integrations")).text);

		const status = doc.querySelector("[data-test-integration-status]");
		assert(status, "the Gmail row must carry a status");
		assert.equal(status.getAttribute("data-test-integration-status"), "disconnecting");
		assert.equal(status.textContent, "Disconnecting\u2026");
		assert.deepEqual(
			Array.from(doc.querySelectorAll("[data-test-integration-action]")).map((el) =>
				el.getAttribute("data-test-integration-action"),
			),
			[],
		);
	});
});
