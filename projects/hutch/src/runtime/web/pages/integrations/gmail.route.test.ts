import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import {
	AliasNameSchema,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
} from "@packages/domain/inbox";
import { GMAIL_SCOPES, GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();
const GMAIL = "/integrations/gmail";
const ADD = `${GMAIL}/senders/add`;
const REMOVE = `${GMAIL}/senders/remove`;
const REMOVE_MAPPING = `${GMAIL}/mappings/remove`;
const DISCOVER = `${GMAIL}/discovery/start`;
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const MORNING = ForwardableSenderSchema.parse("crew@morningbrew.com");
const EMAIL = GmailAccountEmailSchema.parse("reader@gmail.com");

function load(text: string): Document {
	return new JSDOM(text).window.document;
}

function harnessWithGmail() {
	const gmail = initInMemoryGmailIntegration({
		grant: { ok: true, grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES } },
	});
	const harness = useApp({ ...createDefaultTestAppFixture(TEST_APP_ORIGIN), gmailIntegration: gmail.bundle });
	return { harness, gmail };
}

async function connectedAgent(options: { confirmed?: boolean; scope?: string; discovered?: boolean } = {}) {
	const { harness, gmail } = harnessWithGmail();
	const created = await harness.auth.createUser({ email: "reader@example.com", password: "password123" });
	assert(created.ok);
	const userId = created.userId;
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email: "reader@example.com", password: "password123" });
	const gatewayAddress = await gmail.bundle.mintGatewayAddress({ userId });
	await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
	await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: EMAIL });
	await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "refresh", grantedScope: options.scope ?? GMAIL_SCOPES });
	if (options.confirmed !== false) await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
	if (options.discovered !== false) {
		const store = gmail.bundle.gmailDiscoveryStore;
		await store.startDiscovery({ userId, accountEmail: EMAIL, gatewayAddress, generation: "initial", mode: "full", historyId: "100" });
		await store.claimPage({ userId, generation: "initial", page: 0 });
		const previous = await store.findDiscoveryByUserId(userId);
		assert(previous);
		await store.savePage({ previous, senders: [{ email: TLDR, name: "TLDR" }, { email: MORNING, name: "Morning Brew" }], mode: "full", pageToken: undefined, historyId: "100", state: "complete", scannedMessages: 2 });
	}
	const destination = await gmail.bundle.mintInboxAddress({ userId, name: AliasNameSchema.parse("tech") });
	return { harness, gmail, agent, userId, gatewayAddress, destination };
}

describe("Gmail sender mapping page", () => {
	it("requires authentication on page, discovery, and mapping endpoints", async () => {
		const { harness } = harnessWithGmail();
		for (const path of [GMAIL, `${GMAIL}/senders`, `${GMAIL}/status`]) {
			expect((await request(harness.server).get(path)).headers.location).toBe("/login");
		}
		for (const path of [ADD, REMOVE, REMOVE_MAPPING, DISCOVER, `${GMAIL}/disconnect`]) {
			expect((await request(harness.server).post(path)).headers.location).toBe("/login");
		}
	});

	it("requires a current connection before reading or changing mappings", async () => {
		const { harness } = harnessWithGmail();
		const agent = await loginAgent(harness.server, harness.auth);
		expect((await agent.get(GMAIL)).headers.location).toBe("/integrations");
		expect((await agent.post(ADD).type("form").send({ sender: TLDR, destination: "new" })).headers.location).toBe("/integrations");
		expect((await agent.post(`${GMAIL}/disconnect`)).headers.location).toBe("/integrations");
		expect((await agent.get(`${GMAIL}/senders`).set("HX-Request", "true")).headers["hx-redirect"]).toBe("/integrations");
	});

	it("redirects while disconnect is running", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.markDisconnectRequested({ userId });
		expect((await agent.get(GMAIL)).headers.location).toBe("/integrations");
	});

	it("renders discovered senders without querying Gmail or changing forwarding on GET", async () => {
		const { agent, gmail } = await connectedAgent();
		const response = await agent.get(GMAIL);
		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-store");
		expect(response.text).toContain("Morning Brew");
		expect(response.text).toContain(TLDR);
		expect(gmail.discoveryRequests).toEqual([]);
		expect(gmail.rewriteRequests).toEqual([]);
		const doc = load(response.text);
		expect(Array.from(doc.querySelectorAll('input[type="email"]'))).toHaveLength(0);
	});

	it("searches sender names and addresses through an HTML fragment and works without JavaScript", async () => {
		const { agent } = await connectedAgent();
		const response = await agent.get(`${GMAIL}/senders?search=morning&discovery=started`).set("HX-Request", "true");
		expect(response.status).toBe(200);
		expect(response.text).toContain(MORNING);
		const results = load(response.text).querySelector("#gmail-sender-results");
		assert(results);
		expect(results.textContent).toContain("Morning Brew");
		const full = await agent.get(`${GMAIL}/senders?search=TLDR`);
		expect(full.text).toContain('class="gmail"');
	});

	it("renders pending discovery and preserves inbox selection across a page reload", async () => {
		const { agent } = await connectedAgent({ discovered: false });
		const response = await agent.get(`${GMAIL}?discovery=started&search=test`);
		expect(response.status).toBe(200);
		expect(response.text).toContain('name="search"');
	});

	it("starts background discovery only through POST and requests reconsent for older grants", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		expect((await agent.post(DISCOVER)).headers.location).toContain(`${GMAIL}?discovery=started&discovery_after=`);
		expect(gmail.discoveryRequests).toEqual([{ userId }]);
		await gmail.bundle.gmailCredentialsStore.saveCredentials({ userId, refreshToken: "old", grantedScope: GMAIL_SETTINGS_SCOPE });
		expect((await agent.post(DISCOVER)).headers.location).toBe(`${GMAIL}?error=metadata_required`);
		expect(gmail.discoveryRequests).toEqual([{ userId }]);
		expect((await agent.get(GMAIL)).text).toContain("Reconnect");
	});

	it("keeps polling a cached list until the queued refresh starts without replacing entered inbox details", async () => {
		const { agent } = await connectedAgent();
		const started = await agent.post(DISCOVER).type("form").send({ search: "tldr", sender: TLDR, destination: "new" });
		const page = await agent.get(`${started.headers.location}&inbox_name=science`);
		const doc = load(page.text);
		const poll = doc.querySelector("#gmail-sender-results");
		assert(poll);
		const pollUrl = poll.getAttribute("hx-get");
		assert(pollUrl);
		expect(pollUrl).toContain("discovery_after=");
		expect(doc.querySelector('input[name="inbox_name"]')?.getAttribute("value")).toBe("science");
		const fragment = await agent.get(pollUrl).set("HX-Request", "true");
		const fragmentDoc = load(fragment.text);
		expect(fragmentDoc.querySelector("#gmail-sender-results")?.getAttribute("hx-get")).toContain("poll=2");
		expect(fragmentDoc.querySelectorAll('input[name="inbox_name"]').length).toBe(0);
		expect(fragment.headers["hx-push-url"]).toBeUndefined();
	});

	it("retains setup instructions and polls Gmail confirmation", async () => {
		const { agent, gatewayAddress } = await connectedAgent({ confirmed: false });
		const doc = load((await agent.get(GMAIL)).text);
		expect(doc.querySelector("[data-test-gmail-address]")?.textContent).toBe(gatewayAddress);
		const response = await agent.get(`${GMAIL}/status?poll=1`);
		expect(load(response.text).querySelector("[data-test-gmail-poll]")?.getAttribute("hx-get")).toBe(`${GMAIL}/status?poll=2`);
		expect((await agent.get(`${GMAIL}/status?poll=100`)).text).toContain("Still waiting");
	});

	it("redirects completed confirmation with and without htmx", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		expect((await agent.get(`${GMAIL}/status`)).headers.location).toBe(`${GMAIL}?notice=confirmed`);
		expect((await agent.get(`${GMAIL}/status`).set("HX-Request", "true")).headers["hx-redirect"]).toBe(`${GMAIL}?notice=confirmed`);
		await gmail.bundle.gmailConnectionStore.deleteConnection(userId);
		expect((await agent.get(`${GMAIL}/status`)).headers.location).toBe("/integrations");
	});
});

describe("Save a sender mapping", () => {
	it("maps a discovered sender and can move it to another existing inbox", async () => {
		const { agent, gmail, userId, destination } = await connectedAgent();
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, destination });
		expect(save.headers.location).toBe(`${GMAIL}?notice=sender_mapped&discovery=started`);
		expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR }))?.mappedAddress).toBe(destination);
		const ordinary = await gmail.addresses.createAddress({ userId, domain: "read.place", name: AliasNameSchema.parse("reading"), purpose: "user-alias" });
		await agent.post(ADD).type("form").send({ sender: TLDR, destination: ordinary.address });
		expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR }))?.mappedAddress).toBe(ordinary.address);
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }, { userId, reason: "sender-added" }]);
	});

	it("lets an existing mapping be reassigned before mailbox reconsent", async () => {
		const { agent, gmail, userId, destination } = await connectedAgent({ discovered: false, scope: GMAIL_SETTINGS_SCOPE });
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		await agent.post(ADD).type("form").send({ sender: TLDR, destination });
		expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR }))?.mappedAddress).toBe(destination);
	});

	it("requires a real discovered or already mapped sender and an explicit destination", async () => {
		const { agent, gmail, destination } = await connectedAgent();
		for (const body of [{}, { sender: "bad", destination }, { sender: TLDR }]) {
			expect((await agent.post(ADD).type("form").send(body)).headers.location).toBe(`${GMAIL}?error=sender_invalid`);
		}
		expect((await agent.post(ADD).type("form").send({ sender: "unknown@example.com", destination })).headers.location).toContain("error=sender_unknown");
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it.each(["account", "gateway", "missing"])("rejects a stale picker submission when its discovery %s no longer matches the connection", async (change) => {
		const { agent, gmail, userId } = await connectedAgent();
		if (change === "account") {
			await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse("another@gmail.com") });
		} else if (change === "gateway") {
			const gatewayAddress = await gmail.bundle.mintGatewayAddress({ userId });
			await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
			await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: EMAIL });
		} else {
			await gmail.bundle.gmailDiscoveryStore.deleteDiscoveryByUserId(userId);
		}
		const before = await gmail.bundle.listInboxAddresses(userId);
		const response = await agent.post(ADD).type("form").send({ sender: TLDR, destination: "new", inbox_name: "stale" });
		expect(response.headers.location).toContain("error=sender_unknown");
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		expect(await gmail.bundle.listInboxAddresses(userId)).toEqual(before);
		expect(gmail.rewriteRequests).toEqual([]);
	});

	it("refuses disabled, unknown, gateway, and another user's destinations", async () => {
		const { agent, gmail, userId, destination, gatewayAddress, harness } = await connectedAgent();
		await gmail.addresses.disableAddress({ userId, address: destination });
		const other = await harness.auth.createUser({ email: "other@example.com", password: "password123" });
		assert(other.ok);
		const foreign = await gmail.bundle.mintInboxAddress({ userId: other.userId, name: AliasNameSchema.parse("foreign") });
		for (const address of [destination, gatewayAddress, foreign, "missing"]) {
			expect((await agent.post(ADD).type("form").send({ sender: TLDR, destination: address })).headers.location).toContain("error=destination_invalid");
		}
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
	});

	it("creates a named inbox and assigns the selected sender in one save", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await agent.post(ADD).type("form").send({ sender: TLDR, destination: "new", inbox_name: "Science" });
		const row = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert(row?.mappedAddress);
		expect((await gmail.bundle.findInboxAddress(row.mappedAddress))?.name).toBe("science");
		expect(row.addedToFilterAt).toBeDefined();
	});

	it("keeps the sender and entered inbox name when name validation fails", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		for (const name of [undefined, "!!!", "tech"]) {
			const response = await agent.post(ADD).type("form").send({ sender: TLDR, destination: "new", inbox_name: name });
			expect(response.headers.location).toContain(name === "tech" ? "error=inbox_name_taken" : "error=inbox_name_invalid");
			expect(response.headers.location).toContain("sender=dan%40tldr.tech");
		}
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
	});

	it("shares the account cap across regular and Gmail inboxes while permitting existing destinations", async () => {
		const { agent, gmail, userId, destination } = await connectedAgent();
		for (let index = 1; index < INBOX_ADDRESS_MAX_PER_USER; index++) {
			await gmail.addresses.createAddress({ userId, domain: "read.place", name: AliasNameSchema.parse(`inbox-${index}`), purpose: index % 2 === 0 ? "gmail-mapped" : "user-alias" });
		}
		const blocked = await agent.post(ADD).type("form").send({ sender: TLDR, destination: "new", inbox_name: "overflow" });
		expect(blocked.headers.location).toContain("error=inbox_limit");
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		await agent.post(ADD).type("form").send({ sender: TLDR, destination });
		expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR }))?.mappedAddress).toBe(destination);
		await gmail.addresses.disableAddress({ userId, address: destination });
		await agent.post(ADD).type("form").send({ sender: MORNING, destination: "new", inbox_name: "available" });
		expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: MORNING }))?.mappedAddress).toBeDefined();
	});

	it("turns a store-level inbox cap refusal into a form error", async () => {
		const { agent, gmail } = await connectedAgent();
		gmail.bundle.mintInboxAddress = async () => { throw new InboxAddressLimitReachedError(INBOX_ADDRESS_MAX_PER_USER); };
		const response = await agent.post(ADD).type("form").send({ sender: TLDR, destination: "new", inbox_name: "science" });
		expect(response.headers.location).toContain("error=inbox_limit");
		expect(gmail.rewriteRequests).toEqual([]);
	});
});

describe("Remove sender mappings", () => {
	it("removes one sender while keeping its inbox and other assignments", async () => {
		const { agent, gmail, userId, destination } = await connectedAgent();
		for (const sender of [TLDR, MORNING]) await agent.post(ADD).type("form").send({ sender, destination });
		await agent.post(REMOVE).type("form").send({ sender: TLDR });
		expect((await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).map((row) => row.senderEmail)).toEqual([MORNING]);
		expect((await gmail.bundle.findInboxAddress(destination))?.disabledAt).toBeUndefined();
		expect((await gmail.bundle.gmailDiscoveryStore.listSendersByUserId(userId)).map((row) => row.email).sort()).toEqual([MORNING, TLDR].sort());
	});

	it("removes an inbox mapping as a group without disabling or deleting the inbox", async () => {
		const { agent, gmail, userId, destination } = await connectedAgent();
		for (const sender of [TLDR, MORNING]) await agent.post(ADD).type("form").send({ sender, destination });
		const otherSender = ForwardableSenderSchema.parse("another@example.com");
		const otherInbox = await gmail.bundle.mintInboxAddress({ userId, name: AliasNameSchema.parse("another") });
		await gmail.bundle.gmailSenderStore.mapSenderToAddress({ userId, senderEmail: otherSender, mappedAddress: otherInbox });
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: otherSender });
		const response = await agent.post(REMOVE_MAPPING).type("form").send({ destination });
		expect(response.headers.location).toBe(`${GMAIL}?notice=mapping_removed&discovery=started`);
		expect((await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).map((sender) => sender.senderEmail)).toEqual([otherSender]);
		const inbox = await gmail.bundle.findInboxAddress(destination);
		assert(inbox);
		expect(inbox.disabledAt).toBeUndefined();
		expect(gmail.rewriteRequests.at(-1)).toEqual({ userId, reason: "sender-removed" });
	});

	it("can clear legacy gateway-only mappings and rejects malformed removal requests", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		await agent.post(REMOVE_MAPPING).type("form").send({ destination: "legacy" });
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		expect((await agent.post(REMOVE_MAPPING).type("form").send({})).headers.location).toBe(`${GMAIL}?error=destination_invalid`);
		expect((await agent.post(REMOVE).type("form").send({ sender: "bad" })).headers.location).toBe(`${GMAIL}?error=sender_invalid`);
	});

	it("disconnects through the existing background teardown", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		expect((await agent.post(`${GMAIL}/disconnect`)).headers.location).toBe("/integrations");
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
		expect((await gmail.bundle.gmailConnectionStore.findConnectionByUserId(userId))?.disconnectRequestedAt).toBeDefined();
	});

	it("republishes a pending disconnect when its first dispatch failed", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		const publish = gmail.bundle.publishDisconnectGmail;
		let attempts = 0;
		gmail.bundle.publishDisconnectGmail = async (input) => {
			attempts += 1;
			if (attempts === 1) throw new Error("EventBridge unavailable");
			await publish(input);
		};
		expect((await agent.post(`${GMAIL}/disconnect`)).status).toBe(500);
		expect((await gmail.bundle.gmailConnectionStore.findConnectionByUserId(userId))?.disconnectRequestedAt).toBeDefined();
		expect(gmail.disconnectRequests).toEqual([]);
		expect((await agent.post(`${GMAIL}/disconnect`)).headers.location).toBe("/integrations");
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
		expect(attempts).toBe(2);
	});
});
