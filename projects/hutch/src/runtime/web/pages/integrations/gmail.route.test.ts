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
const RETRY = `${GMAIL}/filter/retry`;
const DISCOVER = `${GMAIL}/discovery/start`;
const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const MORNING = ForwardableSenderSchema.parse("crew@morningbrew.com");
const EMAIL = GmailAccountEmailSchema.parse("reader@gmail.com");
const ONE_DAY_MS = 86_400_000;

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

function alertKeys(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-gmail-alert]"), (el) => el.getAttribute("data-test-gmail-alert-key"));
}

function harnessWithGmail(now?: () => Date, appNow?: () => Date) {
	const gmail = initInMemoryGmailIntegration({
		grant: { ok: true, grant: { refreshToken: "refresh", accessToken: "access", grantedScope: GMAIL_SCOPES } },
		...(now === undefined ? {} : { now }),
	});
	const fixture = { ...createDefaultTestAppFixture(TEST_APP_ORIGIN), gmailIntegration: gmail.bundle };
	if (appNow !== undefined) fixture.shared.now = appNow;
	const harness = useApp(fixture);
	return { harness, gmail };
}

async function connectedAgent(options: { confirmed?: boolean; scope?: string; discovered?: boolean; now?: () => Date; appNow?: () => Date } = {}) {
	const { harness, gmail } = harnessWithGmail(options.now, options.appNow);
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
		await store.savePage({ previous, senders: [{ email: TLDR, name: "TLDR" }, { email: MORNING, name: "Morning Brew" }], mode: "full", pageToken: undefined, historyId: "100", state: "complete", scannedMessages: 2, estimatedTotalMessages: 2, oldestScannedAt: undefined });
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
		for (const path of [ADD, REMOVE, RETRY, DISCOVER, `${GMAIL}/disconnect`]) {
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
		expect(poll.getAttribute("hx-trigger")).toBe("every 3s");
		expect(doc.querySelector('input[name="inbox_name"]')?.getAttribute("value")).toBe("science");
		const fragment = await agent.get(pollUrl).set("HX-Request", "true");
		const fragmentDoc = load(fragment.text);
		expect(fragmentDoc.querySelector("#gmail-sender-results")?.getAttribute("hx-get")).toContain("poll=2");
		expect(fragmentDoc.querySelectorAll('input[name="inbox_name"]').length).toBe(0);
		expect(fragment.headers["hx-push-url"]).toBeUndefined();
	});

	it("swaps the load button progress label without replacing the sender search field", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent();
		const discovery = gmail.bundle.gmailDiscoveryStore;
		await discovery.startDiscovery({
			userId,
			accountEmail: EMAIL,
			gatewayAddress,
			generation: "progress",
			mode: "full",
			historyId: "100",
		});
		await discovery.claimPage({ userId, generation: "progress", page: 0 });
		const previous = await discovery.findDiscoveryByUserId(userId);
		assert(previous);
		await discovery.savePage({
			previous,
			senders: [],
			mode: "full",
			pageToken: "next",
			historyId: "100",
			state: "running",
			scannedMessages: 25,
			estimatedTotalMessages: 125,
			oldestScannedAt: undefined,
		});
		const response = await agent.get(`${GMAIL}/senders?discovery=started&poll=1`).set("HX-Request", "true");
		const fragment = load(response.text);
		const button = fragment.querySelector("#gmail-load-senders-button");
		assert(button);
		expect(button.textContent).toBe("Checking 25 of 125 messages…");
		expect(button.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(Array.from(fragment.querySelectorAll("[id]"), (element) => element.id).sort()).toEqual([
			"gmail-load-senders-button",
			"gmail-sender-results",
		]);
	});

	it("slows polling after the first minute and stops honestly once the discovery budget runs out", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent();
		const discovery = gmail.bundle.gmailDiscoveryStore;
		await discovery.startDiscovery({ userId, accountEmail: EMAIL, gatewayAddress, generation: "budget", mode: "full", historyId: "100" });
		await discovery.claimPage({ userId, generation: "budget", page: 0 });
		const previous = await discovery.findDiscoveryByUserId(userId);
		assert(previous);
		await discovery.savePage({ previous, senders: [], mode: "full", pageToken: "next", historyId: "100", state: "running", scannedMessages: 25, estimatedTotalMessages: 125, oldestScannedAt: undefined });

		const slow = load((await agent.get(`${GMAIL}/senders?discovery=started&poll=20`).set("HX-Request", "true")).text);
		expect(slow.querySelector("#gmail-sender-results")?.getAttribute("hx-trigger")).toBe("every 15s");

		const stopped = load((await agent.get(`${GMAIL}/senders?discovery=started&poll=260`).set("HX-Request", "true")).text);
		const results = stopped.querySelector("#gmail-sender-results");
		assert(results);
		expect(results.hasAttribute("hx-get")).toBe(false);
		expect(stopped.querySelector("[data-test-gmail-discovery-status]")?.textContent).toBe(
			"Still checking your mailbox: 25 of 125 messages so far. Choose a sender from the list, or refresh this page to keep watching.",
		);
		expect(stopped.querySelector("#gmail-load-senders-button")?.textContent).toBe("Load senders");
	});

	it("exposes a completed load button from the redirected discovery response", async () => {
		let now = new Date("2026-09-12T00:00:00.000Z");
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent({ now: () => now });
		const discovery = gmail.bundle.gmailDiscoveryStore;
		await discovery.startDiscovery({
			userId,
			accountEmail: EMAIL,
			gatewayAddress,
			generation: "redirect-race",
			mode: "history",
			historyId: "100",
		});
		gmail.bundle.publishStartGmailSenderDiscovery = async ({ userId: requestedUserId }) => {
			expect(requestedUserId).toBe(userId);
			const running = await discovery.findDiscoveryByUserId(userId);
			assert(running);
			now = new Date("2026-09-12T00:00:01.000Z");
			expect(await discovery.claimPage({ userId, generation: running.generation, page: running.page })).toBe(true);
			expect(await discovery.savePage({
				previous: running,
				senders: [],
				mode: "history",
				pageToken: undefined,
				historyId: "100",
				state: "complete",
				scannedMessages: 0,
				estimatedTotalMessages: undefined,
				oldestScannedAt: undefined,
			})).toBe(true);
		};

		const response = await agent.post(DISCOVER).set("HX-Request", "true").redirects(1);
		expect(response.status).toBe(200);
		const page = load(response.text);
		const form = page.querySelector("[data-test-gmail-load-senders]");
		assert(form);
		expect(form.getAttribute("hx-select")).toBe("#gmail-sender-results");
		expect(form.getAttribute("hx-select-oob")).toBe("#gmail-load-senders-button:outerHTML");
		expect(form.querySelector("#gmail-load-senders-button")?.textContent).toBe("Load senders");
		expect(page.querySelector("#gmail-sender-results")?.hasAttribute("hx-get")).toBe(false);
	});

	it("retains setup instructions and polls Gmail confirmation", async () => {
		const { agent, gatewayAddress } = await connectedAgent({ confirmed: false });
		const doc = load((await agent.get(GMAIL)).text);
		expect(doc.querySelector("[data-test-gmail-address]")?.textContent).toBe(gatewayAddress);
		expect(doc.querySelector("[data-test-gmail-poll]")?.getAttribute("hx-get")).toBe(`${GMAIL}/status?poll=1&state=awaiting-confirmation`);
		const response = await agent.get(`${GMAIL}/status?poll=1&state=awaiting-confirmation`);
		expect(load(response.text).querySelector("[data-test-gmail-poll]")?.getAttribute("hx-get")).toBe(`${GMAIL}/status?poll=2&state=awaiting-confirmation`);
		expect((await agent.get(`${GMAIL}/status?poll=100&state=awaiting-confirmation`)).text).toContain("Still waiting");
	});

	it("shows only the reconnect once Google ends the grant", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });
		const doc = load((await agent.get(GMAIL)).text);
		expect(sections(doc)).toEqual(["reconnect"]);
		expect(doc.querySelector("[data-test-gmail-state]")?.getAttribute("data-test-gmail-state")).toBe("revoked");
		const reconnect = doc.querySelector("[data-test-gmail-reconnect] form");
		expect(reconnect?.getAttribute("method")).toBe("POST");
		expect(reconnect?.getAttribute("action")).toBe(
			"/integrations/gmail/connect?utm_source=integrations-gmail&utm_medium=internal&utm_content=reconnect",
		);
	});

	it("stops handing out a gateway address that has been switched off", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent({ confirmed: false });
		await gmail.addresses.disableAddress({ userId, address: gatewayAddress });
		const doc = load((await agent.get(GMAIL)).text);
		expect(sections(doc)).toEqual(["senders"]);
		expect(alertKeys(doc)).toEqual(["gateway_disabled"]);
	});

	it("renders a structured filter failure with a retry action", async () => {
		const { agent, gmail, userId, destination } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.recordFilterError({
			userId,
			error: {
				code: "query-too-long",
				forwardTo: destination,
				senderCount: 40,
				senderCapacity: 36,
				at: "2026-09-16T00:00:00.000Z",
			},
		});
		const doc = load((await agent.get(GMAIL)).text);
		const filter = doc.querySelector('[data-test-gmail-filter-state="failed"]');
		assert(filter, "the failed filter state must render");
		expect(alertKeys(doc)).toEqual([]);
		const message = filter.querySelector("[data-test-gmail-filter-message]");
		assert(message, "the failed filter state must explain the failure");
		expect(message.textContent).toBe(
			"Gmail's forwarding rule for tech ran out of room at 36 of its 40 senders. Exclude some, or move some to another inbox, then try again.",
		);
		const retry = filter.querySelector('[data-test-gmail-filter-action="retry"]');
		assert(retry, "the failed filter state must offer a retry action");
		const retryForm = retry.closest("form");
		assert(retryForm, "the retry action must submit a form");
		expect(retryForm.getAttribute("method")).toBe("POST");
		const retryAction = retryForm.getAttribute("action");
		assert(retryAction, "the retry form must carry an action");
		expect(new URL(retryAction, "https://readplace.com").pathname).toBe(RETRY);
	});

	it("retries a filter rewrite after a failure", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailConnectionStore.recordFilterError({
			userId,
			error: {
				code: "rejected",
				message: "Unrecognized forwarding address",
				at: "2026-09-16T00:00:00.000Z",
			},
		});

		const response = await agent.post(RETRY).send();

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`${GMAIL}?notice=filter_retry_requested`);
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "retry-requested" }]);
	});

	it("does not retry before forwarding is confirmed or after Gmail is revoked", async () => {
		const unconfirmed = await connectedAgent({ confirmed: false });
		const unconfirmedResponse = await unconfirmed.agent.post(RETRY).send();
		expect(unconfirmedResponse.status).toBe(303);
		expect(unconfirmedResponse.headers.location).toBe(GMAIL);
		expect(unconfirmed.gmail.rewriteRequests).toEqual([]);

		const revoked = await connectedAgent();
		await revoked.gmail.bundle.gmailConnectionStore.markRevoked({
			userId: revoked.userId,
			reason: "invalid-grant",
		});
		const revokedResponse = await revoked.agent.post(RETRY).send();
		expect(revokedResponse.status).toBe(303);
		expect(revokedResponse.headers.location).toBe(GMAIL);
		expect(revoked.gmail.rewriteRequests).toEqual([]);
	});

	it("shows a mapping as pending until the filter rewrite records it", async () => {
		let now = new Date("2026-09-16T00:00:00.000Z");
		const { agent, gmail, userId, destination } = await connectedAgent({ now: () => now });
		await gmail.bundle.gmailSenderStore.mapSenderToAddress({
			userId,
			senderEmail: TLDR,
			mappedAddress: destination,
		});
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		now = new Date("2026-09-16T00:01:00.000Z");
		await gmail.bundle.gmailConnectionStore.recordFilter({
			userId,
			filterCount: 1,
			filterSenderCount: 1,
		});
		now = new Date("2026-09-16T00:02:00.000Z");
		await gmail.bundle.gmailSenderStore.mapSenderToAddress({
			userId,
			senderEmail: MORNING,
			mappedAddress: destination,
		});
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: MORNING });

		const doc = load((await agent.get(GMAIL)).text);
		const senderStates = Array.from(doc.querySelectorAll("[data-test-gmail-mapped-sender]"), (sender) => [
			sender.getAttribute("data-test-gmail-mapped-sender"),
			sender.getAttribute("data-test-gmail-mapped-sender-state"),
		]);
		expect(Object.fromEntries(senderStates)).toEqual({
			[TLDR]: "live",
			[MORNING]: "pending",
		});
		const filter = doc.querySelector('[data-test-gmail-filter-state="updating"]');
		assert(filter, "the pending sender must make the filter state updating");
		const message = filter.querySelector("[data-test-gmail-filter-message]");
		assert(message, "the updating filter state must explain the delay");
		expect(message.textContent).toBe(
			"Gmail hasn't accepted the latest change yet. Refresh in a moment, or try again.",
		);
	});

	it("surfaces a failed confirmation, keeps watching, and confirms once Google sends a new link", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent({ confirmed: false });
		await gmail.bundle.gmailConnectionStore.recordConfirmError({
			userId,
			error: { reason: "token-rejected", at: "2026-09-14T00:00:00.000Z" },
		});

		const doc = load((await agent.get(GMAIL)).text);
		expect(doc.querySelector("[data-test-gmail-state]")?.getAttribute("data-test-gmail-state")).toBe("confirm-failed");
		expect(doc.querySelector('[data-test-gmail-alert-key="confirm_failed"]')?.textContent).toContain("already been used or had expired");
		expect(doc.querySelector("[data-test-gmail-address]")?.textContent).toBe(gatewayAddress);
		expect(doc.querySelector("[data-test-gmail-poll]")?.getAttribute("hx-get")).toBe(`${GMAIL}/status?poll=1&state=confirm-failed`);

		const fragment = await agent.get(`${GMAIL}/status?poll=1&state=confirm-failed`);
		expect(load(fragment.text).querySelector("[data-test-gmail-poll]")?.getAttribute("hx-get")).toBe(`${GMAIL}/status?poll=2&state=confirm-failed`);

		expect((await agent.get(`${GMAIL}/status?poll=1&state=awaiting-confirmation`)).headers.location).toBe(GMAIL);
		expect((await agent.get(`${GMAIL}/status?poll=1&state=awaiting-confirmation`).set("HX-Request", "true")).headers["hx-redirect"]).toBe(GMAIL);

		await gmail.bundle.gmailConnectionStore.markForwardingConfirmed({ userId });
		expect((await agent.get(`${GMAIL}/status?poll=1&state=confirm-failed`)).headers.location).toBe(`${GMAIL}?notice=confirmed`);
	});

	it("redirects a poll that names no state so the page re-renders", async () => {
		const { agent } = await connectedAgent({ confirmed: false });
		expect((await agent.get(`${GMAIL}/status?poll=1`)).headers.location).toBe(GMAIL);
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
	it("searches and saves mapped-only senders when discovery is empty", async () => {
		const { agent, gmail, userId, destination } = await connectedAgent({ discovered: false });
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		await gmail.bundle.gmailSenderStore.mapSenderToAddress({ userId, senderEmail: TLDR, mappedAddress: destination });
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: MORNING });
		const reading = await gmail.addresses.createAddress({
			userId,
			domain: "read.place",
			name: AliasNameSchema.parse("reading"),
			purpose: "gmail-mapped",
		});

		for (const [sender, target] of [[MORNING, destination], [TLDR, reading.address]] as const) {
			const response = await agent
				.get(`${GMAIL}/senders?search=${encodeURIComponent(sender)}&discovery=started`)
				.set("HX-Request", "true");
			const option = load(response.text).querySelector(`[data-test-gmail-sender-option="${sender}"]`);
			assert(option);
			const chooser = option.closest("form");
			assert(chooser);
			expect(chooser.querySelector<HTMLInputElement>('input[name="sender"]')?.value).toBe(sender);
			await agent.post(ADD).type("form").send({ sender, destination: target });
			expect((await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: sender }))?.mappedAddress).toBe(target);
		}
	});

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

	it("saves a mapping during Step 2 and says forwarding starts after confirmation", async () => {
		const { agent, gmail, userId, destination } = await connectedAgent({ confirmed: false });
		const save = await agent.post(ADD).type("form").send({ sender: TLDR, destination });
		const doc = load((await agent.get(save.headers.location)).text);
		expect(doc.querySelector("[data-test-gmail-state]")?.getAttribute("data-test-gmail-state")).toBe("awaiting-confirmation");
		const notice = doc.querySelector('[data-test-gmail-notice-key="sender_mapped"]');
		assert(notice);
		expect(notice.textContent).toBe("Mapping saved. New mail from this sender will be forwarded once Gmail confirms the forwarding address.");
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-added" }]);
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
		const created = await agent.post(ADD).type("form").send({ sender: TLDR, destination: "new", inbox_name: "Science" });
		expect(created.headers.location).toBe(`${GMAIL}?notice=inbox_created&discovery=started`);
		const row = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert(row?.mappedAddress);
		expect((await gmail.bundle.findInboxAddress(row.mappedAddress))?.name).toBe("science");
		expect(row.addedToFilterAt).toBeDefined();
	});

	it("creates an inbox named gmail even though the machine-owned gateway already carries that alias", async () => {
		const { agent, gmail, userId, gatewayAddress } = await connectedAgent();
		const response = await agent
			.post(ADD)
			.type("form")
			.send({ sender: TLDR, destination: "new", inbox_name: "gmail" });
		expect(response.headers.location).toBe(`${GMAIL}?notice=inbox_created&discovery=started`);
		const row = await gmail.bundle.gmailSenderStore.findSender({ userId, senderEmail: TLDR });
		assert(row?.mappedAddress);
		const mapped = await gmail.bundle.findInboxAddress(row.mappedAddress);
		expect(mapped?.name).toBe("gmail");
		expect(mapped?.address).not.toBe(gatewayAddress);
		expect((await gmail.bundle.findInboxAddress(gatewayAddress))?.name).toBe("gmail");
	});

	it("keeps the sender and entered inbox name when name validation fails", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		for (const name of [undefined, "!!!", "tech"]) {
			const response = await agent.post(ADD).type("form").send({ sender: TLDR, destination: "new", inbox_name: name });
			expect(response.headers.location).toContain(name === "tech" ? "error=inbox_name_taken" : "error=inbox_name_invalid");
			expect(response.headers.location).toContain("sender=dan%40tldr.tech");
			expect(response.headers.location).toContain("destination=new");
			if (name !== undefined) {
				expect(new URL(response.headers.location, "https://readplace.com").searchParams.get("inbox_name")).toBe(name);
			}
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

describe("Exclude mapped senders", () => {
	it("removes the mapping card after its final sender is excluded while keeping the inbox", async () => {
		const { agent, gmail, userId, destination } = await connectedAgent();
		for (const sender of [TLDR, MORNING]) await agent.post(ADD).type("form").send({ sender, destination });
		await agent.post(REMOVE).type("form").send({ sender: TLDR });
		expect((await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).map((row) => row.senderEmail)).toEqual([MORNING]);
		expect((await gmail.bundle.findInboxAddress(destination))?.disabledAt).toBeUndefined();
		expect((await gmail.bundle.gmailDiscoveryStore.listSendersByUserId(userId)).map((row) => row.email).sort()).toEqual([MORNING, TLDR].sort());
		const oneSender = load((await agent.get(GMAIL)).text);
		expect(Array.from(oneSender.querySelectorAll("[data-test-gmail-mapping]"), (mapping) => mapping.getAttribute("data-test-gmail-mapping"))).toEqual([destination]);
		await agent.post(REMOVE).type("form").send({ sender: MORNING });
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		const noSenders = load((await agent.get(GMAIL)).text);
		expect(Array.from(noSenders.querySelectorAll("[data-test-gmail-mapping]"), (mapping) => mapping.getAttribute("data-test-gmail-mapping"))).toEqual([]);
		expect(noSenders.querySelector("[data-test-gmail-empty]")?.textContent).toBe("No mappings yet. Choose a Gmail sender and an inbox above.");
		expect((await gmail.bundle.findInboxAddress(destination))?.disabledAt).toBeUndefined();
	});

	it("excludes a legacy sender individually and rejects a malformed request", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		await agent.post(REMOVE).type("form").send({ sender: TLDR });
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		expect((await agent.post(REMOVE).type("form").send({ sender: "bad" })).headers.location).toBe(`${GMAIL}?error=sender_invalid`);
	});

	it("disconnects through the existing background teardown", async () => {
		const { agent, gmail, userId } = await connectedAgent();
		expect((await agent.post(`${GMAIL}/disconnect`)).headers.location).toBe("/integrations?notice=gmail_disconnected");
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
		expect((await agent.post(`${GMAIL}/disconnect`)).headers.location).toBe("/integrations?notice=gmail_disconnected");
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
		expect(attempts).toBe(2);
	});

	it("lets a read-only reader exclude a mapped sender", async () => {
		const { agent, gmail, userId, harness } = await connectedAgent();
		await gmail.bundle.gmailSenderStore.addSenderToFilter({ userId, senderEmail: TLDR });
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post(REMOVE).type("form").send({ sender: TLDR });

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe(`${GMAIL}?notice=sender_removed&discovery=started`);
		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		expect(gmail.rewriteRequests).toEqual([{ userId, reason: "sender-removed" }]);
	});

	it("lets a read-only reader disconnect Gmail", async () => {
		const { agent, gmail, userId, harness } = await connectedAgent();
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		const response = await agent.post(`${GMAIL}/disconnect`).send();

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations?notice=gmail_disconnected");
		expect((await gmail.bundle.gmailConnectionStore.findConnectionByUserId(userId))?.disconnectRequestedAt).toBeDefined();
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
	});

	it("lets a locked reader disconnect Gmail", async () => {
		const { agent, gmail, userId } = await connectedAgent({
			appNow: () => new Date(Date.now() + 8 * ONE_DAY_MS),
		});

		const response = await agent.post(`${GMAIL}/disconnect`).set("Accept", "text/html").send();

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/integrations?notice=gmail_disconnected");
		expect((await gmail.bundle.gmailConnectionStore.findConnectionByUserId(userId))?.disconnectRequestedAt).toBeDefined();
		expect(gmail.disconnectRequests).toEqual([{ userId }]);
	});

	it("still bounces a read-only reader's save actions to the inactive queue", async () => {
		const { agent, gmail, userId, destination, harness } = await connectedAgent();
		await harness.subscriptionProviders.upsertTrialing({
			userId,
			trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
		});

		for (const path of [ADD, DISCOVER]) {
			const response = await agent.post(path).set("Accept", "text/html").type("form").send({ sender: TLDR, destination });
			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?inactive=1");
		}

		expect(await gmail.bundle.gmailSenderStore.listSendersByUserId(userId)).toEqual([]);
		expect(gmail.discoveryRequests).toEqual([]);
	});
});
