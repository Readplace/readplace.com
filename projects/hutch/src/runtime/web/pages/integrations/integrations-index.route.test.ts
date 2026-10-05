import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { AliasNameSchema, InboxAddressSchema } from "@packages/domain/inbox";
import { GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { BROWSER_REQUEST_HEADERS, loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const GATEWAY = InboxAddressSchema.parse("gmail-a7b2c9@read.place");

function load(text: string): Document {
	return new JSDOM(text).window.document;
}

function integrationActions(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll('[data-test-integration="gmail"] [data-test-integration-action]')).map((el) =>
		el.getAttribute("data-test-integration-action"),
	);
}

describe("GET /newsletters", () => {
	it("redirects an anonymous reader to the login page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/newsletters");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it("lists the services for a signed-in reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/newsletters");

		expect(response.status).toBe(200);
		const doc = load(response.text);
		const services = Array.from(doc.querySelectorAll("[data-test-integration]")).map((el) =>
			el.getAttribute("data-test-integration"),
		);
		expect(services).toEqual(["gmail", "custom-emails"]);
	});

	it("shows Gmail as not set up", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/newsletters")).text);

		const gmail = doc.querySelector('[data-test-integration="gmail"]');
		assert(gmail, "the Gmail row must render");
		const status = gmail.querySelector("[data-test-integration-status]");
		assert(status, "the Gmail row must carry a status");
		expect(status.getAttribute("data-test-integration-status")).toBe("disconnected");
		expect(status.textContent).toBe("Not set up");
	});

	it("names the Gmail card Newsletters from Gmail and says it sends newsletters to readlists", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const gmail = load((await agent.get("/newsletters")).text).querySelector('[data-test-integration="gmail"]');
		assert(gmail, "the Gmail row must render");

		expect(gmail.querySelector(".integrations__name")?.firstChild?.textContent?.trim()).toBe("Newsletters from Gmail");
		expect(gmail.querySelector(".integrations__description")?.textContent).toBe("Send newsletters from Gmail to your readlists.");
	});

	it("tags only the Gmail card as Beta", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/newsletters")).text);

		const tagged = Array.from(doc.querySelectorAll("[data-test-integration-beta]")).map((el) => [
			el.closest("[data-test-integration]")?.getAttribute("data-test-integration"),
			el.textContent,
		]);
		expect(tagged).toEqual([["gmail", "Beta"]]);
	});

	it("opens the experimental disclaimer instead of submitting when a reader first connects Gmail", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/newsletters")).text);

		const connect = doc.querySelector("[data-test-integration-action='connect']");
		assert(connect, "the connect action renders");
		expect(connect.closest("form")).toBeNull();
		expect(connect.getAttribute("type")).toBe("button");
		expect(connect.getAttribute("popovertarget")).toBe("gmail-connect-disclaimer");
		expect(connect.getAttribute("aria-haspopup")).toBe("dialog");

		const popover = doc.querySelector('[data-test-confirm-popover="gmail-connect-disclaimer"]');
		assert(popover, "the disclaimer popover renders");
		expect(popover.id).toBe("gmail-connect-disclaimer");
		expect(popover.closest("main")).not.toBeNull();
		expect(popover.querySelector(".confirm-popover__title")?.textContent).toBe("Gmail integration is experimental");
		expect(popover.querySelector(".confirm-popover__body")?.textContent).toBe(
			"Readplace only reads your newsletters: it never sends, changes or deletes your email. It adds one filter to forward the senders you choose.",
		);
		const ok = popover.querySelector("[data-test-action='gmail-connect-ok']");
		assert(ok, "the disclaimer offers OK");
		expect(ok.getAttribute("type")).toBe("submit");
		expect(ok.textContent).toBe("OK");
		const form = ok.closest("form");
		assert(form, "OK submits a form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(
			"/newsletters/gmail/connect?utm_source=integrations&utm_medium=internal&utm_content=connect",
		);
		expect(form.hasAttribute("hx-boost")).toBe(false);
	});

	it("lets a revoked reader reconnect directly, without the first-connect disclaimer", async () => {
		const gmail = initInMemoryGmailIntegration({
			addresses: initInMemoryInboxAddress({ now: () => new Date() }),
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
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress: GATEWAY });
		await gmail.bundle.gmailConnectionStore.markRevoked({ userId, reason: "invalid-grant" });

		const doc = load((await agent.get("/newsletters")).text);

		const reconnect = doc.querySelector("[data-test-integration-action='reconnect']");
		assert(reconnect, "the reconnect action renders");
		expect(reconnect.textContent).toBe("Reconnect Gmail");
		expect(reconnect.getAttribute("type")).toBe("submit");
		const form = reconnect.closest("form");
		assert(form, "reconnect submits a form");
		expect(form.getAttribute("method")).toBe("POST");
		expect(form.getAttribute("action")).toBe(
			"/newsletters/gmail/connect?utm_source=integrations&utm_medium=internal&utm_content=reconnect",
		);
		expect(doc.querySelector("[data-test-confirm-popover]")).toBeNull();
	});

	it("counts the reader's active custom emails and links to manage them", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		const { inboxAddressStore, inboxAddressDomain } = fixture.inboxAddress;
		for (const name of ["news", "tech"]) {
			await inboxAddressStore.createAddress({
				userId,
				domain: inboxAddressDomain,
				name: AliasNameSchema.parse(name),
				purpose: "user-alias",
			});
		}

		const doc = load((await agent.get("/newsletters")).text);

		const customEmails = doc.querySelector('[data-test-integration="custom-emails"]');
		assert(customEmails, "the Custom Emails row must render");
		expect(customEmails.querySelector(".integrations__name")?.textContent).toBe("My Custom Emails");
		const status = customEmails.querySelector("[data-test-integration-status]");
		assert(status, "the Custom Emails row must carry a status");
		expect(status.textContent).toBe("2 active");
		const form = customEmails.querySelector("[data-test-integration-action='custom-emails']")?.closest("form");
		assert(form, "the Custom Emails row navigates via a form");
		expect(form.getAttribute("action")).toBe("/newsletters/custom-emails?utm_source=integrations&utm_medium=internal&utm_content=custom-emails");
		expect(form.querySelector<HTMLInputElement>("input[name='from']")?.value).toBe("newsletters");
	});

	it("offers only Connect to a reader with no connection", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/newsletters")).text);

		expect(integrationActions(doc)).toEqual(["connect"]);
	});

	it.each(["trial", "expired", "cancelled"])("offers a tracked upgrade to a %s reader", async (state) => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user, "the signed-in reader must exist");
		harness.subscriptionProviders.seedRow({
			userId: user.userId,
			provider: "stripe",
			status: state === "cancelled" ? "cancelled" : "trialing",
			trialEndsAt: new Date(Date.now() + (state === "trial" ? 86_400_000 : -86_400_000)).toISOString(),
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const doc = load((await agent.get("/newsletters")).text);
		expect(integrationActions(doc)).toEqual(["upgrade-gmail"]);
		const row = doc.querySelector('[data-test-integration="gmail"]');
		assert(row, "the Gmail row must render");
		const copy = row.querySelector(".integrations__description");
		assert(copy, "the Gmail row must explain access");
		expect(copy.textContent).toBe("Gmail integration is only available with an active paid subscription.");
		const upgrade = row.querySelector('[data-test-integration-action="upgrade-gmail"]');
		assert(upgrade, "the blocked connection offers an upgrade");
		expect(upgrade.textContent).toBe("Upgrade");
		const form = upgrade.closest("form");
		assert(form, "Upgrade navigates with a form");
		expect(form.getAttribute("method")).toBe("GET");
		const destination = new URL(form.action, TEST_APP_ORIGIN);
		destination.search = new URLSearchParams(Array.from(form.querySelectorAll<HTMLInputElement>("input"), (field) => [field.name, field.value])).toString();
		expect(destination.pathname).toBe("/account/plans");
		expect(Object.fromEntries(destination.searchParams)).toEqual({
			utm_source: "integrations",
			utm_medium: "internal",
			utm_content: "upgrade-gmail",
		});
		const plans = await agent.get(destination.pathname + destination.search).set(BROWSER_REQUEST_HEADERS);
		expect(plans.status).toBe(200);
		expect(load(plans.text).body.classList.contains("page-plans")).toBe(true);
		expect(harness.analytics.events.filter((event) => event.event === "click")).toEqual([
			expect.objectContaining({ path: "/account/plans", utm_source: "integrations", utm_medium: "internal", utm_content: "upgrade-gmail" }),
		]);
	});

	it("routes a connected-but-unconfirmed reader to finish setup on the Gmail page", async () => {
		const gmail = initInMemoryGmailIntegration({
			addresses: initInMemoryInboxAddress({ now: () => new Date() }),
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
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
		assert(userId, "seeded login user must exist");
		await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress: GATEWAY });

		const doc = load((await agent.get("/newsletters")).text);

		expect(integrationActions(doc)).toEqual(["finish-setup"]);
		const action = doc.querySelector("[data-test-integration-action='finish-setup']");
		assert(action, "the finish-setup action renders");
		const form = action.closest("form");
		assert(form, "the finish-setup action navigates via a form");
		expect(form.getAttribute("method")?.toLowerCase()).toBe("get");
		expect(form.getAttribute("action")).toBe("/newsletters/gmail?utm_source=integrations&utm_medium=internal&utm_content=finish-setup");
	});

	it("boosts the action form and loads the clipboard bundle so a boosted hop keeps copy working", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/newsletters");
		const doc = load(response.text);

		const action = doc.querySelector("[data-test-integration-action='custom-emails']");
		assert(action, "the custom emails action renders");
		const form = action.closest("form");
		assert(form, "the action navigates via a form");
		expect(form.getAttribute("hx-boost")).toBe("true");
		expect(form.getAttribute("hx-target")).toBe("main");
		expect(form.getAttribute("hx-select")).toBe("main");
		expect(form.getAttribute("hx-swap")).toBe("outerHTML show:none");
		expect(response.text).toContain("/client-dist/integrations.client.js");
	});

	it("renders the alert an interrupted connection redirects back with", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/newsletters?error=oauth_state")).text);

		const alert = doc.querySelector('[data-test-alert-variant="error"]');
		assert(alert, "the index must render an alert for a redirect that carried an error");
		expect(alert.getAttribute("data-test-alert")).toBe("oauth_state");
		expect(alert.getAttribute("role")).toBe("alert");
		expect(alert.classList.contains("alert--visible")).toBe(true);
	});

	it("tells a first-time reader to connect again with header access beside a Not set up Gmail row", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/newsletters?error=oauth_metadata_scope_first_connect")).text);

		const alert = doc.querySelector('[data-test-alert-variant="error"]');
		assert(alert, "the index must render the first-connect metadata alert");
		expect(alert.getAttribute("data-test-alert")).toBe("oauth_metadata_scope_first_connect");
		expect(alert.getAttribute("role")).toBe("alert");
		expect(alert.classList.contains("alert--visible")).toBe(true);
		expect(alert.textContent).toBe(
			"Readplace needs permission to read message headers so you can choose senders from your mailbox. Connect again and leave that permission ticked.",
		);
		const gmail = doc.querySelector('[data-test-integration="gmail"]');
		assert(gmail, "the Gmail row must render");
		const status = gmail.querySelector("[data-test-integration-status]");
		assert(status, "the Gmail row must carry a status");
		expect(status.textContent).toBe("Not set up");
		expect(integrationActions(doc)).toEqual(["connect"]);
	});

	it("renders the notice a disconnect redirects back with", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/newsletters?notice=gmail_disconnected")).text);

		const notice = doc.querySelector('[data-test-alert-variant="info"]');
		assert(notice, "the index must render a notice for a redirect that carried one");
		expect(notice.getAttribute("data-test-alert")).toBe("gmail_disconnected");
		expect(notice.getAttribute("role")).toBe("status");
		expect(notice.classList.contains("alert--visible")).toBe(true);
	});

	it("keeps the page out of search results", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/newsletters")).text);

		const robots = doc.querySelector('meta[name="robots"]');
		assert(robots, "the page must declare a robots policy");
		expect(robots.getAttribute("content")).toBe("noindex, nofollow");
	});
});

describe("Integrations nav entry", () => {
	it("appears in the header for every signed-in reader", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const doc = load((await agent.get("/queue")).text);

		const entry = doc.querySelector('[data-test-nav-item="integrations"]');
		assert(entry, "the integrations nav entry must render for a signed-in reader");
		const form = entry.closest("form");
		assert(form, "every nav entry renders inside a form");
		expect(form.getAttribute("action")).toBe(
			"/newsletters?utm_source=header-nav&utm_medium=internal&utm_content=integrations",
		);
	});
});
