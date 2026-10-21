import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_USER_AGENT, describeUntrackedCtas, findUntrackedCtas } from "@packages/web-test-harness";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();

type Harness = ReturnType<typeof useApp>;
type Agent = ReturnType<typeof request.agent>;

const PASSWORD = "password123";
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const EXTENSION_CALLBACK = "http://127.0.0.1:3000/oauth/callback";
const IOS_CALLBACK = "readplace://oauth-callback";
const ANDROID_CALLBACK = "readplace://oauth-callback/android";

function generatePKCE() {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

async function signIn(harness: Harness, email: string): Promise<Agent> {
	await harness.auth.createUser({ email, password: PASSWORD });
	const agent = request.agent(harness.server).set("User-Agent", BROWSER_USER_AGENT);
	await agent.post("/login").type("form").send({ email, password: PASSWORD });
	return agent;
}

async function grant(
	harness: Harness,
	input: { agent: Agent; clientId: string; redirectUri: string },
): Promise<{ refreshToken: string }> {
	const pkce = generatePKCE();
	const authorize = await input.agent.post("/oauth/authorize").type("form").send({
		client_id: input.clientId,
		redirect_uri: input.redirectUri,
		response_type: "code",
		code_challenge: pkce.challenge,
		code_challenge_method: "S256",
		state: "connected-apps",
		action: "approve",
	});
	assert.equal(authorize.status, 302, "the reader's approval must redirect with a code");
	const code = new URL(authorize.headers.location).searchParams.get("code");
	assert(code, "the approval must carry an authorization code");
	const token = await request(harness.server).post("/oauth/token").type("form").send({
		grant_type: "authorization_code",
		code,
		redirect_uri: input.redirectUri,
		client_id: input.clientId,
		code_verifier: pkce.verifier,
	});
	assert.equal(token.status, 200, "the authorization code must exchange for tokens");
	return { refreshToken: token.body.refresh_token };
}

async function registerAssistant(harness: Harness, input: { name: string; redirectUri: string }): Promise<string> {
	const registration = await request(harness.server)
		.post("/oauth/register")
		.send({ redirect_uris: [input.redirectUri], client_name: input.name });
	assert.equal(registration.status, 201, "the assistant must register itself");
	return registration.body.client_id;
}

function refresh(harness: Harness, input: { clientId: string; refreshToken: string }) {
	return request(harness.server).post("/oauth/token").type("form").send({
		grant_type: "refresh_token",
		refresh_token: input.refreshToken,
		client_id: input.clientId,
	});
}

async function accountPage(agent: Agent, path: string): Promise<Document> {
	const response = await agent.get(path);
	assert.equal(response.status, 200, `${path} must render for the signed-in reader`);
	return new JSDOM(response.text).window.document;
}

function connectedApps(doc: Document): Element {
	const section = doc.querySelector("[data-test-connected-apps]");
	assert(section, "the account page must render its connected apps section");
	return section;
}

function rowKeys(section: Element): string[] {
	return Array.from(section.querySelectorAll("[data-test-connected-app]")).map(
		(row) => row.getAttribute("data-test-connected-app") ?? "",
	);
}

function rowFor(section: Element, clientId: string): Element {
	const row = section.querySelector(`[data-test-connected-app-client="${clientId}"]`);
	assert(row, `the ${clientId} row must render`);
	return row;
}

function disconnectActions(section: Element): string[] {
	return Array.from(section.querySelectorAll("form[data-test-connected-app-action]")).map(
		(form) => form.getAttribute("action") ?? "",
	);
}

describe("GET /account (connected apps)", () => {
	it("keeps the section with its empty row for a reader who has signed in to no app", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "connected-none@example.com");

		const section = connectedApps(await accountPage(agent, "/account"));

		expect(section.getAttribute("data-test-connected-apps-state")).toBe("empty");
		expect(rowKeys(section)).toEqual(["empty"]);
	});

	it("lists the Chrome extension the reader signed in to", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "connected-chrome@example.com");
		await grant(harness, { agent, clientId: "hutch-chrome-extension", redirectUri: EXTENSION_CALLBACK });

		const section = connectedApps(await accountPage(agent, "/account"));

		expect(section.getAttribute("data-test-connected-apps-state")).toBe("listed");
		expect(rowKeys(section)).toEqual(["chrome"]);
		expect(rowFor(section, "hutch-chrome-extension").querySelector(".account-row__title")?.textContent).toBe(
			"Chrome extension",
		);
	});

	it("lists a registered Claude after the built-in apps, connected from its redirect host", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "connected-claude@example.com");
		const claudeId = await registerAssistant(harness, { name: "Claude", redirectUri: CLAUDE_CALLBACK });
		await grant(harness, { agent, clientId: claudeId, redirectUri: CLAUDE_CALLBACK });
		await grant(harness, { agent, clientId: "hutch-chrome-extension", redirectUri: EXTENSION_CALLBACK });

		const section = connectedApps(await accountPage(agent, "/account"));

		expect(rowKeys(section)).toEqual(["chrome", "claude"]);
		expect(rowFor(section, claudeId).querySelector(".account-row__description")?.textContent).toBe(
			"Connected from claude.ai.",
		);
	});

	it("calls an assistant the roster does not know an AI assistant", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "connected-unknown@example.com");
		const clientId = await registerAssistant(harness, { name: "Mystery Agent", redirectUri: CLAUDE_CALLBACK });
		await grant(harness, { agent, clientId, redirectUri: CLAUDE_CALLBACK });

		const section = connectedApps(await accountPage(agent, "/account"));

		expect(rowKeys(section)).toEqual(["assistant"]);
		expect(rowFor(section, clientId).querySelector(".account-row__title")?.textContent).toBe("AI assistant");
	});

	it("leaves out a client that no longer resolves, which can never refresh again", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const resolve = fixture.oauth.findClient;
		const swept = new Set<string>();
		fixture.oauth.findClient = async (clientId) => (swept.has(clientId) ? undefined : resolve(clientId));
		const harness = useApp(fixture);
		const agent = await signIn(harness, "connected-swept@example.com");
		const clientId = await registerAssistant(harness, { name: "Claude", redirectUri: CLAUDE_CALLBACK });
		await grant(harness, { agent, clientId, redirectUri: CLAUDE_CALLBACK });
		swept.add(clientId);

		const section = connectedApps(await accountPage(agent, "/account"));

		expect(section.getAttribute("data-test-connected-apps-state")).toBe("empty");
		expect(rowKeys(section)).toEqual(["empty"]);
	});

	it("tags every call to action in the section, listed or empty", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "connected-tracking@example.com");
		const empty = connectedApps(await accountPage(agent, "/account"));
		await grant(harness, { agent, clientId: "hutch-chrome-extension", redirectUri: EXTENSION_CALLBACK });
		const listed = connectedApps(await accountPage(agent, "/account"));

		expect([empty, listed].map((section) => section.getAttribute("data-test-connected-apps-state"))).toEqual([
			"empty",
			"listed",
		]);
		const untracked = [empty, listed].flatMap((section) =>
			describeUntrackedCtas(findUntrackedCtas(section.outerHTML, { skipSelectors: [], ownOrigin: TEST_APP_ORIGIN })),
		);
		expect(untracked).toEqual([]);
	});

	it("keeps the app sheet's markers on the sign-out it renders inside the sheet", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "connected-sheet@example.com");
		await grant(harness, { agent, clientId: "hutch-chrome-extension", redirectUri: EXTENSION_CALLBACK });

		const section = connectedApps(await accountPage(agent, "/account?platform=ios&shell=app"));

		expect(disconnectActions(section)).toEqual([
			"/account/connected-apps/hutch-chrome-extension/disconnect?platform=ios&shell=app&utm_source=account&utm_medium=internal&utm_content=disconnect-app",
			"/account/connected-apps/hutch-chrome-extension/disconnect?platform=ios&shell=app&utm_source=account&utm_medium=internal&utm_content=disconnect-app",
		]);
	});
});

describe("GET /account (dialog focus)", () => {
	it.each([
		{ surface: "web", path: "/account", email: "dialog-focus-web@example.com" },
		{ surface: "app sheet", path: "/account?platform=ios&shell=app", email: "dialog-focus-sheet@example.com" },
	])("loads the script that hands focus back to a dismissed dialog's trigger on the $surface", async ({ path, email }) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, email);

		const doc = await accountPage(agent, path);

		expect(
			Array.from(doc.querySelectorAll('script[src^="/client-dist/account-dialogs"]'), (script) => script.getAttribute("src")),
		).toEqual(["/client-dist/account-dialogs.client.js"]);
	});
});

describe("POST /account/connected-apps/:clientId/disconnect", () => {
	it("refuses the disconnected client's refresh while another client keeps refreshing, and returns to the section", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "disconnect-chrome@example.com");
		const chrome = await grant(harness, { agent, clientId: "hutch-chrome-extension", redirectUri: EXTENSION_CALLBACK });
		const claudeId = await registerAssistant(harness, { name: "Claude", redirectUri: CLAUDE_CALLBACK });
		const claude = await grant(harness, { agent, clientId: claudeId, redirectUri: CLAUDE_CALLBACK });

		const response = await agent.post("/account/connected-apps/hutch-chrome-extension/disconnect");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account#connected-apps");
		const refused = await refresh(harness, { clientId: "hutch-chrome-extension", refreshToken: chrome.refreshToken });
		expect([refused.status, refused.body.error]).toEqual([400, "invalid_grant"]);
		const refreshed = await refresh(harness, { clientId: claudeId, refreshToken: claude.refreshToken });
		expect(refreshed.status).toBe(200);
		expect(rowKeys(connectedApps(await accountPage(agent, "/account")))).toEqual(["claude"]);
	});

	it("keeps every session signed in when it disconnects a client", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const email = "disconnect-sessions@example.com";
		const agent = await signIn(harness, email);
		await grant(harness, { agent, clientId: "hutch-chrome-extension", redirectUri: EXTENSION_CALLBACK });
		await grant(harness, { agent, clientId: "ios-app", redirectUri: IOS_CALLBACK });

		await agent.post("/account/connected-apps/hutch-chrome-extension/disconnect");
		const afterChrome = await accountPage(agent, "/account");
		await agent.post("/account/connected-apps/ios-app/disconnect");
		const afterIphone = await accountPage(agent, "/account");

		expect(
			[afterChrome, afterIphone].map((doc) => doc.querySelector('[data-test-account-profile-line="email"]')?.textContent),
		).toEqual([email, email]);
		expect([afterChrome, afterIphone].map((doc) => rowKeys(connectedApps(doc)))).toEqual([["iphone"], ["empty"]]);
	});

	it("returns the app sheet to the section after it disconnects another app", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "disconnect-sheet-chrome@example.com");
		await grant(harness, { agent, clientId: "hutch-chrome-extension", redirectUri: EXTENSION_CALLBACK });

		const response = await agent.post("/account/connected-apps/hutch-chrome-extension/disconnect?platform=ios&shell=app");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?platform=ios&shell=app#connected-apps");
	});

	it("signs the iPhone app out through its own sheet when the sheet disconnects it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "disconnect-sheet-iphone@example.com");
		await grant(harness, { agent, clientId: "ios-app", redirectUri: IOS_CALLBACK });

		const response = await agent.post("/account/connected-apps/ios-app/disconnect?platform=ios&shell=app");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("readplace://account/logout");
	});

	it("sends the same sign-out link through HX-Redirect for the sheet's boosted form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "disconnect-sheet-htmx@example.com");
		await grant(harness, { agent, clientId: "ios-app", redirectUri: IOS_CALLBACK });

		const response = await agent
			.post("/account/connected-apps/ios-app/disconnect?platform=ios&shell=app")
			.set("HX-Request", "true");

		expect(response.status).toBe(200);
		expect(response.headers["hx-redirect"]).toBe("readplace://account/logout");
	});

	it("signs the Android app out through its own sheet when the sheet disconnects it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "disconnect-sheet-android@example.com");
		await grant(harness, { agent, clientId: "android-app", redirectUri: ANDROID_CALLBACK });

		const response = await agent.post("/account/connected-apps/android-app/disconnect?platform=android&shell=app");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("readplace://account/logout");
	});

	it("returns an iOS page outside the sheet to the section, since no sheet can follow the sign-out link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "disconnect-ios-surface@example.com");
		await grant(harness, { agent, clientId: "ios-app", redirectUri: IOS_CALLBACK });

		const response = await agent.post("/account/connected-apps/ios-app/disconnect?platform=ios");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?platform=ios#connected-apps");
	});

	it("returns a sheet that names no platform to the section, and the app's next refresh is refused", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "disconnect-shell-only@example.com");
		const iphone = await grant(harness, { agent, clientId: "ios-app", redirectUri: IOS_CALLBACK });

		const response = await agent.post("/account/connected-apps/ios-app/disconnect?shell=app");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?shell=app#connected-apps");
		const refused = await refresh(harness, { clientId: "ios-app", refreshToken: iphone.refreshToken });
		expect([refused.status, refused.body.error]).toEqual([400, "invalid_grant"]);
	});

	it("leaves the reader's grants alone for a client they never connected", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await signIn(harness, "disconnect-never-granted@example.com");
		const chrome = await grant(harness, { agent, clientId: "hutch-chrome-extension", redirectUri: EXTENSION_CALLBACK });

		const response = await agent.post("/account/connected-apps/hutch-firefox-extension/disconnect");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account#connected-apps");
		const refreshed = await refresh(harness, { clientId: "hutch-chrome-extension", refreshToken: chrome.refreshToken });
		expect(refreshed.status).toBe(200);
	});

	it("sends a signed-out request to log in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post("/account/connected-apps/hutch-chrome-extension/disconnect");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});
});
