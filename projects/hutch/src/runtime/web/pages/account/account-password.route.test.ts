import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { JSDOM } from "jsdom";
import request from "supertest";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import { BROWSER_USER_AGENT } from "@packages/web-test-harness";
import { useTestServer } from "../../../test-app";

const useApp = useTestServer();

const EMAIL = "reader@example.com";
const CURRENT_PASSWORD = "Current-Secret-41";
const NEW_PASSWORD = "Brand-New-Secret-52";
const WRONG_PASSWORD = "Wrong-Guess-63";
const FORM_ACTION = "/account/password?utm_source=account-password&utm_medium=internal&utm_content=change-password";
const HTMX = { "HX-Request": "true" };

const HxLocationSchema = z
	.object({ path: z.string(), source: z.string(), target: z.string(), select: z.string(), swap: z.string() })
	.strict();

type Harness = ReturnType<ReturnType<typeof useTestServer>>;

async function signIn(harness: Harness) {
	const agent = request.agent(harness.server).set("User-Agent", BROWSER_USER_AGENT);
	const login = await agent.post("/login").type("form").send({ email: EMAIL, password: CURRENT_PASSWORD });
	expect(login.status).toBe(303);
	return agent;
}

async function signUp(harness: Harness) {
	const created = await harness.auth.createUser({ email: EMAIL, password: CURRENT_PASSWORD });
	assert(created.ok, "the test reader must be created");
	return { agent: await signIn(harness), userId: created.userId };
}

function documentOf(html: string): Document {
	return new JSDOM(html).window.document;
}

function changeForm(root: ParentNode): HTMLFormElement {
	const form = root.querySelector<HTMLFormElement>('[data-test-form="change-password"]');
	assert(form, "the change-password form must render");
	return form;
}

function fieldErrors(root: ParentNode): string[][] {
	return Array.from(root.querySelectorAll("[data-test-error]")).map((error) => [
		error.getAttribute("data-test-error") ?? "",
		error.textContent ?? "",
	]);
}

function passwordValues(root: ParentNode): string[] {
	return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]')).map((input) => input.value);
}

function sessionCookieOf(response: request.Response): string {
	const cookies = response.headers["set-cookie"];
	assert(Array.isArray(cookies), "the answer must set cookies");
	const session = cookies.find((cookie) => cookie.startsWith("hutch_sid="));
	assert(session, "the answer must set a session cookie");
	return session;
}

function hxLocation(response: request.Response): z.infer<typeof HxLocationSchema> {
	const header = response.headers["hx-location"];
	assert(header, "an htmx answer that lands must tell htmx where to go");
	return HxLocationSchema.parse(JSON.parse(header));
}

async function grantRefreshToken(
	harness: Harness,
	input: { agent: ReturnType<typeof request.agent>; clientId: string; redirectUri: string },
): Promise<string> {
	const verifier = randomBytes(32).toString("base64url");
	const authorize = await input.agent.post("/oauth/authorize").type("form").send({
		client_id: input.clientId,
		redirect_uri: input.redirectUri,
		response_type: "code",
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		code_challenge_method: "S256",
		state: "change-password",
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
		code_verifier: verifier,
	});
	assert.equal(token.status, 200, "the authorization code must exchange for tokens");
	return token.body.refresh_token;
}

async function registerAssistant(harness: Harness, redirectUri: string): Promise<string> {
	const registration = await request(harness.server)
		.post("/oauth/register")
		.send({ redirect_uris: [redirectUri], client_name: "Claude" });
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

function changeRequest(fields: { currentPassword: string; password: string; confirmPassword: string }) {
	return { username: EMAIL, ...fields };
}

const VALID_CHANGE = changeRequest({
	currentPassword: CURRENT_PASSWORD,
	password: NEW_PASSWORD,
	confirmPassword: NEW_PASSWORD,
});

describe("GET /account/password", () => {
	it("renders the change card: three password fields posting in place, a plain way to reset and a boosted way back", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const response = await agent.get("/account/password");

		expect(response.status).toBe(200);
		const doc = documentOf(response.text);
		expect(doc.body.classList.contains("page-change-password")).toBe(true);
		expect(doc.title).toBe("Change password — Readplace");
		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
		const main = doc.querySelector("main.auth-page");
		assert(main, "the page must render its <main>");
		const card = doc.getElementById("change-password-card");
		assert(card, "the page must render the change card");
		expect(card.parentElement).toBe(main);
		expect(card.querySelector(".auth-card__title")?.textContent).toBe("Change your password");
		expect(card.querySelector(".auth-card__subtitle")?.textContent).toBe(
			"Changing it signs you out in every other browser and disconnects the browser extension, the iPhone app, and AI assistants.",
		);
		const form = changeForm(card);
		expect(
			["method", "action", "hx-post", "hx-target", "hx-swap", "hx-sync", "hx-disabled-elt"].map((name) =>
				form.getAttribute(name),
			),
		).toEqual(["POST", FORM_ACTION, FORM_ACTION, "this", "outerHTML show:none", "closest .auth-card:drop", "find button"]);
		expect([main, card].map((element) => element.getAttribute("hx-sync"))).toEqual([null, null]);
		expect(form.closest(".auth-card")).toBe(card);
		const username = form.querySelector<HTMLInputElement>('input[name="username"]');
		assert(username, "the form must name the account for password managers");
		expect([username.type, username.value, username.autocomplete, username.readOnly, username.hidden]).toEqual([
			"email",
			EMAIL,
			"username",
			true,
			true,
		]);
		expect(
			Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]')).map((input) => [
				input.id,
				input.name,
				input.autocomplete,
				input.required,
				input.getAttribute("minlength"),
				doc.querySelector(`label[for="${input.id}"]`)?.textContent,
			]),
		).toEqual([
			["currentPassword", "currentPassword", "current-password", true, null, "Current password"],
			["password", "password", "new-password", true, "8", "New password"],
			["confirmPassword", "confirmPassword", "new-password", true, null, "Confirm new password"],
		]);
		expect(passwordValues(form)).toEqual(["", "", ""]);
		expect(fieldErrors(form)).toEqual([]);
		const submit = form.querySelector('button[data-test-action="change-password"]');
		assert(submit, "the form must render its submit");
		expect(submit.querySelector(".auth-form__submit-label")?.textContent).toBe("Change password");
		expect(submit.querySelector(".auth-form__loader")?.getAttribute("aria-hidden")).toBe("true");
		const forgot = card.querySelector<HTMLAnchorElement>(".auth-card__footer--forgot a");
		assert(forgot, "the card must offer the forgot-password escape");
		expect([forgot.textContent, forgot.getAttribute("href"), forgot.getAttribute("hx-boost")]).toEqual([
			"Forgot your current password?",
			"/forgot-password?utm_source=account-password&utm_medium=internal&utm_content=forgot-password",
			null,
		]);
		const back = card.querySelector<HTMLAnchorElement>("[data-test-back-to-account] a");
		assert(back, "the card must offer a way back to the account page");
		expect(
			["href", "hx-boost", "hx-target", "hx-select", "hx-swap"].map((name) => back.getAttribute(name)),
		).toEqual([
			"/account?utm_source=account-password&utm_medium=internal&utm_content=back-to-account",
			"true",
			"main",
			"main",
			"outerHTML show:none scroll:html:top",
		]);
		expect(back.textContent).toBe("Back to account");
	});

	it("carries a failure line the page script fills when the change never gets an answer", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const doc = documentOf((await agent.get("/account/password")).text);

		const form = changeForm(doc);
		expect(form.getAttribute("data-change-password-failure")).toBe("Couldn't change your password.");
		const line = form.querySelector("[data-test-change-password-failure]");
		assert(line, "the form must carry its failure line");
		expect([line.textContent, line.getAttribute("role"), line.nextElementSibling?.getAttribute("data-test-action")]).toEqual([
			"",
			"alert",
			"change-password",
		]);
		expect(
			Array.from(doc.querySelectorAll('script[src="/client-dist/change-password.client.js"]'), (script) =>
				script.hasAttribute("defer"),
			),
		).toEqual([true]);
	});

	it.each([
		{ surface: "web", path: "/account" },
		{ surface: "app sheet", path: "/account?platform=ios&shell=app" },
	])("loads the failure-line script on the $surface account page, whose boosted Change password brings the form in", async ({ path }) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const doc = documentOf((await agent.get(path)).text);

		expect(doc.querySelectorAll('script[src="/client-dist/change-password.client.js"]').length).toBe(1);
	});

	it.each([
		{
			surface: "web",
			path: "/account/password",
			scripts: [
				"/client-dist/account-cards.client.js",
				"/client-dist/account-dialogs.client.js",
				"/client-dist/change-password.client.js",
			],
		},
		{
			surface: "app sheet",
			path: "/account/password?platform=ios&shell=app",
			scripts: ["/client-dist/account-dialogs.client.js", "/client-dist/change-password.client.js"],
		},
	])("loads the $surface account page's scripts, so the account page a change lands on works without a reload", async ({ path, scripts }) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const doc = documentOf((await agent.get(path)).text);

		expect(
			Array.from(doc.querySelectorAll('script[src^="/client-dist/account-"], script[src^="/client-dist/change-password"]'), (script) =>
				script.getAttribute("src"),
			),
		).toEqual(scripts);
	});

	it("marks no header nav item as the current page, since the change page belongs to none of them", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const doc = documentOf((await agent.get("/account/password")).text);

		const items = Array.from(doc.querySelectorAll("[data-test-nav-item]"));
		expect(items.length).toBeGreaterThan(0);
		expect(items.map((item) => item.getAttribute("aria-current"))).toEqual(items.map(() => null));
	});

	it.each([
		["the web", "/account/password", 1],
		["the app sheet", "/account/password?platform=ios&shell=app", 0],
	])("pins the reader's dark appearance on %s", async (_surface, path, headers) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signUp(harness);
		await harness.auth.setUserAppearance({ userId, appearance: "dark" });

		const doc = documentOf((await agent.get(path)).text);

		expect(doc.body.classList.contains("theme-dark")).toBe(true);
		expect(doc.querySelectorAll(".header")).toHaveLength(headers);
	});

	it.each([
		["current-incorrect", "currentPassword", "Current password is incorrect"],
		["current-missing", "currentPassword", "Enter your current password"],
		["too-many-attempts", "currentPassword", "Too many attempts — try again later"],
		["password-short", "password", "Password must be at least 8 characters"],
		["confirm-missing", "confirmPassword", "Please confirm your password"],
		["mismatch", "confirmPassword", "Passwords do not match"],
	])("renders the %s refusal a no-JS post was sent back with under its field", async (code, field, message) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const doc = documentOf((await agent.get(`/account/password?error=${code}`)).text);

		const form = changeForm(doc);
		expect(fieldErrors(form)).toEqual([[field, message]]);
		const input = form.querySelector<HTMLInputElement>(`#${field}`);
		assert(input, `the ${field} input must render`);
		expect([input.getAttribute("aria-invalid"), input.getAttribute("aria-describedby"), input.autofocus]).toEqual([
			"true",
			`${field}-error`,
			true,
		]);
		expect(passwordValues(form)).toEqual(["", "", ""]);
	});

	it("renders the empty form for an error value that names no refusal", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const doc = documentOf((await agent.get("/account/password?error=something-else")).text);

		expect(fieldErrors(changeForm(doc))).toEqual([]);
		expect(
			Array.from(changeForm(doc).querySelectorAll<HTMLInputElement>('input[type="password"]')).map(
				(input) => input.autofocus,
			),
		).toEqual([false, false, false]);
	});
});

describe("/account/password signed out", () => {
	it.each(["get", "post"] as const)("sends a plain %s to the login page", async (method) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)[method]("/account/password");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/login");
	});

	it.each(["get", "post"] as const)("sends an htmx %s to the login page as a whole-page redirect", async (method) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)[method]("/account/password").set(HTMX);

		expect(response.status).toBe(200);
		expect(response.headers["hx-redirect"]).toBe("/login");
		expect(response.text).toBe("");
	});
});

describe("/account/password for an account with no password", () => {
	async function signInWithGoogle(harness: Harness) {
		const userId = UserIdSchema.parse("google-reader");
		await harness.auth.createGoogleUser({ email: "google-reader@example.com", userId });
		const sessionId = await harness.auth.createSession({ userId, emailVerified: true });
		return { cookie: `hutch_sid=${sessionId}` };
	}

	it("sends the page back to the account page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { cookie } = await signInWithGoogle(harness);

		const response = await request(harness.server).get("/account/password").set("Cookie", cookie);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
	});

	it("lands a no-JS post on the account page without changing anything", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { cookie } = await signInWithGoogle(harness);

		const response = await request(harness.server)
			.post(FORM_ACTION)
			.set("Cookie", cookie)
			.type("form")
			.send(VALID_CHANGE);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account");
		expect(await harness.auth.findUserPasswordStatus(UserIdSchema.parse("google-reader"))).toEqual({
			kind: "not-set",
		});
	});

	it("lands an htmx post on the account page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { cookie } = await signInWithGoogle(harness);

		const response = await request(harness.server)
			.post(FORM_ACTION)
			.set("Cookie", cookie)
			.set(HTMX)
			.type("form")
			.send(VALID_CHANGE);

		expect(response.status).toBe(204);
		expect(hxLocation(response).path).toBe("/account");
	});
});

describe("POST /account/password — a valid change", () => {
	const CHANGED_AT = new Date("2026-10-15T08:30:00.000Z");

	function fixtureAt() {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.shared.now = () => CHANGED_AT;
		return fixture;
	}

	it("saves the new password, records when, and lands a no-JS post on the account page with a fresh session", async () => {
		const harness = useApp(fixtureAt());
		const { agent, userId } = await signUp(harness);

		const response = await agent.post(FORM_ACTION).type("form").send(VALID_CHANGE);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?password=changed");
		expect(sessionCookieOf(response)).toMatch(/^hutch_sid=[^;]+;/);
		expect(await harness.auth.verifyCredentials({ email: EMAIL, password: NEW_PASSWORD })).toEqual({
			ok: true,
			userId,
			emailVerified: false,
		});
		expect(await harness.auth.verifyCredentials({ email: EMAIL, password: CURRENT_PASSWORD })).toEqual({
			ok: false,
			reason: "invalid-credentials",
		});
		expect(await harness.auth.findUserPasswordStatus(userId)).toEqual({
			kind: "set",
			updatedAt: CHANGED_AT.toISOString(),
		});
	});

	it("answers an htmx post with a fresh session and a swap of <main> to the account page at the top", async () => {
		const harness = useApp(fixtureAt());
		const { agent } = await signUp(harness);

		const response = await agent.post(FORM_ACTION).set(HTMX).type("form").send(VALID_CHANGE);

		expect(response.status).toBe(204);
		expect(sessionCookieOf(response)).toMatch(/^hutch_sid=[^;]+;/);
		expect(hxLocation(response)).toEqual({
			path: "/account?password=changed",
			source: "#change-password-card",
			target: "main",
			select: "main",
			swap: "outerHTML show:none scroll:html:top",
		});
		const landing = await agent.get(hxLocation(response).path);
		expect(landing.status).toBe(200);
		const alert = documentOf(landing.text).querySelector('[data-test-alert="password-changed"]');
		assert(alert, "the landing must render the password-changed alert");
		expect(alert.classList.contains("alert--visible")).toBe(true);
	});

	it("signs out every other session so a stolen session cannot outlive the change", async () => {
		const harness = useApp(fixtureAt());
		const { agent } = await signUp(harness);
		const otherBrowser = await signIn(harness);

		const change = await agent.post(FORM_ACTION).type("form").send(VALID_CHANGE);
		expect(change.status).toBe(303);

		const stolen = await otherBrowser.get("/account");
		expect(stolen.status).toBe(303);
		expect(stolen.headers.location).toBe("/login");
		const kept = await agent.get("/account");
		expect(kept.status).toBe(200);
	});

	it("disconnects every connected app, the extension and an AI assistant alike", async () => {
		const harness = useApp(fixtureAt());
		const { agent } = await signUp(harness);
		const extensionToken = await grantRefreshToken(harness, {
			agent,
			clientId: "hutch-chrome-extension",
			redirectUri: "http://127.0.0.1:3000/oauth/callback",
		});
		const claudeId = await registerAssistant(harness, "https://claude.ai/api/mcp/auth_callback");
		const claudeToken = await grantRefreshToken(harness, {
			agent,
			clientId: claudeId,
			redirectUri: "https://claude.ai/api/mcp/auth_callback",
		});

		const change = await agent.post(FORM_ACTION).type("form").send(VALID_CHANGE);
		expect(change.status).toBe(303);

		const refreshes = await Promise.all([
			refresh(harness, { clientId: "hutch-chrome-extension", refreshToken: extensionToken }),
			refresh(harness, { clientId: claudeId, refreshToken: claudeToken }),
		]);
		expect(refreshes.map((answer) => [answer.status, answer.body.error])).toEqual([
			[400, "invalid_grant"],
			[400, "invalid_grant"],
		]);
	});

	it("keeps every connected app when the change is refused", async () => {
		const harness = useApp(fixtureAt());
		const { agent } = await signUp(harness);
		const extensionToken = await grantRefreshToken(harness, {
			agent,
			clientId: "hutch-chrome-extension",
			redirectUri: "http://127.0.0.1:3000/oauth/callback",
		});

		const refused = await agent
			.post(FORM_ACTION)
			.type("form")
			.send(changeRequest({ currentPassword: WRONG_PASSWORD, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }));
		expect(refused.status).toBe(303);

		const refreshed = await refresh(harness, { clientId: "hutch-chrome-extension", refreshToken: extensionToken });
		expect(refreshed.status).toBe(200);
	});

	it("never writes a submitted password into an answer", async () => {
		const harness = useApp(fixtureAt());
		const { agent } = await signUp(harness);

		const plain = await agent.post(FORM_ACTION).type("form").send(VALID_CHANGE);
		const page = await agent.get("/account?password=changed");

		expect(plain.headers.location).toBe("/account?password=changed");
		expect([plain.text, page.text].map((text) => text.includes(NEW_PASSWORD) || text.includes(CURRENT_PASSWORD))).toEqual([
			false,
			false,
		]);
	});
});

describe("POST /account/password — a refused change", () => {
	it("refuses a wrong current password in place under htmx, with the error on the current field and nothing changed", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId } = await signUp(harness);
		const otherBrowser = await signIn(harness);

		const response = await agent
			.post(FORM_ACTION)
			.set(HTMX)
			.type("form")
			.send(changeRequest({ currentPassword: WRONG_PASSWORD, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }));

		expect(response.status).toBe(422);
		expect(response.headers["content-type"]).toMatch(/^text\/html/);
		const fragment = JSDOM.fragment(response.text);
		expect(Array.from(fragment.children).map((child) => child.tagName)).toEqual(["FORM"]);
		const form = changeForm(fragment);
		expect(form.getAttribute("hx-post")).toBe(FORM_ACTION);
		expect(fieldErrors(form)).toEqual([["currentPassword", "Current password is incorrect"]]);
		const error = form.querySelector('[data-test-error="currentPassword"]');
		assert(error, "the current-password error must render");
		expect(error.getAttribute("role")).toBe("alert");
		const current = form.querySelector<HTMLInputElement>("#currentPassword");
		assert(current, "the current-password input must render");
		expect([current.getAttribute("aria-invalid"), current.autofocus]).toEqual(["true", true]);
		expect(passwordValues(form)).toEqual(["", "", ""]);
		expect([WRONG_PASSWORD, NEW_PASSWORD].map((secret) => response.text.includes(secret))).toEqual([false, false]);
		expect(await harness.auth.verifyCredentials({ email: EMAIL, password: CURRENT_PASSWORD })).toEqual({
			ok: true,
			userId,
			emailVerified: false,
		});
		expect((await agent.get("/account")).status).toBe(200);
		expect((await otherBrowser.get("/account")).status).toBe(200);
	});

	it("sends a no-JS wrong current password back to the page, which shows the same error", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const response = await agent
			.post(FORM_ACTION)
			.type("form")
			.send(changeRequest({ currentPassword: WRONG_PASSWORD, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }));

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account/password?error=current-incorrect");
		const doc = documentOf((await agent.get(response.headers.location)).text);
		expect(fieldErrors(changeForm(doc))).toEqual([["currentPassword", "Current password is incorrect"]]);
	});

	it.each([
		[
			"an empty current password",
			{ currentPassword: "", password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
			"current-missing",
			[["currentPassword", "Enter your current password"]],
		],
		[
			"a new password under 8 characters",
			{ currentPassword: CURRENT_PASSWORD, password: "short", confirmPassword: "short" },
			"password-short",
			[["password", "Password must be at least 8 characters"]],
		],
		[
			"an empty confirmation",
			{ currentPassword: CURRENT_PASSWORD, password: NEW_PASSWORD, confirmPassword: "" },
			"confirm-missing",
			[["confirmPassword", "Please confirm your password"]],
		],
		[
			"a confirmation that differs",
			{ currentPassword: CURRENT_PASSWORD, password: NEW_PASSWORD, confirmPassword: `${NEW_PASSWORD}-typo` },
			"mismatch",
			[["confirmPassword", "Passwords do not match"]],
		],
		[
			"an empty current password and a short new one",
			{ currentPassword: "", password: "short", confirmPassword: "short" },
			"current-missing",
			[
				["currentPassword", "Enter your current password"],
				["password", "Password must be at least 8 characters"],
			],
		],
	])("refuses %s, naming every error in place and the first in the no-JS redirect", async (_case, fields, code, errors) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const htmx = await agent.post(FORM_ACTION).set(HTMX).type("form").send(changeRequest(fields));
		const plain = await agent.post(FORM_ACTION).type("form").send(changeRequest(fields));

		expect(htmx.status).toBe(422);
		const form = changeForm(JSDOM.fragment(htmx.text));
		expect(fieldErrors(form)).toEqual(errors);
		const autofocused = Array.from(form.querySelectorAll<HTMLInputElement>("input[autofocus]")).map((input) => input.id);
		expect(autofocused).toEqual([errors[0]?.[0]]);
		expect(passwordValues(form)).toEqual(["", "", ""]);
		expect(plain.status).toBe(303);
		expect(plain.headers.location).toBe(`/account/password?error=${code}`);
	});

	it.each([
		["no body at all", (post: request.Test) => post],
		["a form with no fields", (post: request.Test) => post.type("form").send("")],
		[
			"every field sent twice",
			(post: request.Test) =>
				post
					.type("form")
					.send(
						`currentPassword=${CURRENT_PASSWORD}&currentPassword=${CURRENT_PASSWORD}&password=${NEW_PASSWORD}&password=${NEW_PASSWORD}&confirmPassword=${NEW_PASSWORD}&confirmPassword=${NEW_PASSWORD}`,
					),
		],
	])("refuses %s as it refuses empty fields, in place and in the no-JS redirect", async (_case, withBody) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const htmx = await withBody(agent.post(FORM_ACTION).set(HTMX));
		const plain = await withBody(agent.post(FORM_ACTION));

		expect(htmx.status).toBe(422);
		expect(fieldErrors(changeForm(JSDOM.fragment(htmx.text)))).toEqual([
			["currentPassword", "Enter your current password"],
			["password", "Password must be at least 8 characters"],
			["confirmPassword", "Please confirm your password"],
		]);
		expect(plain.status).toBe(303);
		expect(plain.headers.location).toBe("/account/password?error=current-missing");
		expect(await harness.auth.verifyCredentials({ email: EMAIL, password: CURRENT_PASSWORD })).toMatchObject({ ok: true });
	});

	it("refuses once the login budget for the account is spent, in place and without a 429", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		fixture.rateLimit = {
			consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
			rules: { ...fixture.rateLimit.rules, loginAccount: { limit: 2, windowSeconds: 900 } },
		};
		const harness = useApp(fixture);
		const { agent } = await signUp(harness);
		const wrong = changeRequest({ currentPassword: WRONG_PASSWORD, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });

		const first = await agent.post(FORM_ACTION).set(HTMX).type("form").send(wrong);
		const throttled = await agent.post(FORM_ACTION).set(HTMX).type("form").send(wrong);
		const throttledPlain = await agent.post(FORM_ACTION).type("form").send(VALID_CHANGE);

		expect(first.status).toBe(422);
		expect(fieldErrors(JSDOM.fragment(first.text))).toEqual([["currentPassword", "Current password is incorrect"]]);
		expect(throttled.status).toBe(422);
		expect(fieldErrors(JSDOM.fragment(throttled.text))).toEqual([
			["currentPassword", "Too many attempts — try again later"],
		]);
		expect(throttledPlain.status).toBe(303);
		expect(throttledPlain.headers.location).toBe("/account/password?error=too-many-attempts");
		expect(await harness.auth.verifyCredentials({ email: EMAIL, password: CURRENT_PASSWORD })).toMatchObject({ ok: true });
	});
});

describe("/account/password on the app's surfaces", () => {
	it.each(["ios", "android"] as const)(
		"keeps the %s app sheet chromeless and carries its markers through every link and landing",
		async (platform) => {
			const markers = `platform=${platform}&shell=app`;
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { agent } = await signUp(harness);

			const page = await agent.get(`/account/password?${markers}`);

			expect(page.status).toBe(200);
			const doc = documentOf(page.text);
			expect(doc.querySelectorAll(".header")).toHaveLength(0);
			const action = changeForm(doc).getAttribute("action");
			expect(action).toBe(`/account/password?${markers}&utm_source=account-password&utm_medium=internal&utm_content=change-password`);
			expect(doc.querySelector("[data-test-back-to-account] a")?.getAttribute("href")).toBe(
				`/account?${markers}&utm_source=account-password&utm_medium=internal&utm_content=back-to-account`,
			);
			assert(action, "the form must post somewhere");
			const wrong = changeRequest({ currentPassword: WRONG_PASSWORD, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
			const refused = await agent.post(action).type("form").send(wrong);
			expect(refused.headers.location).toBe(`/account/password?error=current-incorrect&${markers}`);
			const refusedInPlace = await agent.post(action).set(HTMX).type("form").send(wrong);
			expect(changeForm(JSDOM.fragment(refusedInPlace.text)).getAttribute("hx-post")).toBe(action);
			const changed = await agent.post(action).set(HTMX).type("form").send(VALID_CHANGE);
			expect(hxLocation(changed).path).toBe(`/account?password=changed&${markers}`);
			const landing = documentOf((await agent.get(hxLocation(changed).path)).text);
			expect(landing.body.classList.contains("page-account--chromeless")).toBe(true);
		},
	);

	it("lands a no-JS change from the app sheet back in the sheet", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const response = await agent
			.post("/account/password?platform=ios&shell=app")
			.type("form")
			.send(VALID_CHANGE);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/account?password=changed&platform=ios&shell=app");
	});

	it("renders the iOS surface through the site chrome, carrying its marker", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent } = await signUp(harness);

		const doc = documentOf((await agent.get("/account/password?platform=ios")).text);

		expect(doc.querySelectorAll(".header")).toHaveLength(1);
		expect(changeForm(doc).getAttribute("action")).toBe(
			"/account/password?platform=ios&utm_source=account-password&utm_medium=internal&utm_content=change-password",
		);
		expect(doc.querySelector("[data-test-back-to-account] a")?.getAttribute("href")).toBe(
			"/account?platform=ios&utm_source=account-password&utm_medium=internal&utm_content=back-to-account",
		);
	});
});
