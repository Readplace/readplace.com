import assert from "node:assert/strict";
import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { CANARY_REPORTS_PATH } from "@packages/provider-contracts/canary-report";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { SESSION_COOKIE_NAME, readCookie } from "@packages/web-session";
import { useTestServer } from "../../../test-app";
import { ADMIN_DASHBOARDS_PATH } from "./admin-dashboards.url";
import { totpCodeAt } from "./totp";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const USER_EMAIL = "alex@example.com";
const USER_PASSWORD = "password456";
const ADMIN_SECRET = Buffer.from("3132333435363738393031323334353637383930", "hex");

const useApp = useTestServer();

function buildHarness(input: {
	totpSecrets?: ReadonlyMap<string, Buffer>;
	secondFactorAttemptRule?: { limit: number; windowSeconds: number };
	now?: () => Date;
} = {}) {
	const defaults = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const fixture = { ...defaults, shared: { ...defaults.shared, now: input.now ?? defaults.shared.now } };
	const harness = useApp({
		...fixture,
		admin: {
			...fixture.admin,
			adminEmails: [ADMIN_EMAIL],
			totpSecrets: input.totpSecrets ?? new Map([[ADMIN_EMAIL, ADMIN_SECRET]]),
			secondFactorAttemptRule: input.secondFactorAttemptRule ?? fixture.admin.secondFactorAttemptRule,
		},
	});
	const codeAt = (stepOffset: number) =>
		totpCodeAt({ secret: ADMIN_SECRET, atMs: fixture.shared.now().getTime() + stepOffset * 30_000 });
	const currentCode = () => codeAt(0);
	const wrongCode = () => {
		const accepted = [codeAt(-1), codeAt(0), codeAt(1)];
		const wrong = ["000000", "111111", "222222", "333333"].find((code) => !accepted.includes(code));
		assert(wrong, "one of four distinct codes is outside the three accepted ones");
		return wrong;
	};
	return { ...harness, currentCode, wrongCode, serviceToken: fixture.admin.recrawlServiceToken };
}

async function loginAs(input: { server: Server; email: string; password: string }) {
	const agent = request.agent(input.server);
	await agent.post("/login").type("form").send({ email: input.email, password: input.password });
	return agent;
}

async function signedInAdmin(harness: ReturnType<typeof buildHarness>) {
	await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
	return loginAs({ server: harness.server, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
}

function challengeErrorOf(html: string): string | undefined {
	const document = new JSDOM(html).window.document;
	const form = document.querySelector('[data-test-form="admin-mfa"]');
	assert(form, "the challenge form must be rendered");
	return form.querySelector("[data-test-admin-mfa-error]")?.textContent?.trim();
}

describe("every admin mount requires the second factor", () => {
	const adminMounts = [
		"/admin",
		"/admin/recrawl",
		"/admin/extend-trial",
		"/admin/founder-notes",
		"/admin/newsletters",
		`${CANARY_REPORTS_PATH}/2026-11-13`,
		ADMIN_DASHBOARDS_PATH,
	];

	it.each(adminMounts)("redirects an admin who has not passed the challenge away from GET %s", async (path) => {
		const harness = buildHarness();
		const agent = await signedInAdmin(harness);

		const response = await agent.get(path);

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/admin/mfa");
	});

	it("redirects an admin who has not passed the challenge away from POST /admin/extend-trial", async () => {
		const harness = buildHarness();
		const agent = await signedInAdmin(harness);

		const response = await agent.post("/admin/extend-trial").type("form").send({ email: USER_EMAIL });

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/admin/mfa");
	});
});

describe("GET /admin/mfa", () => {
	it("sends an anonymous visitor to /login", async () => {
		const harness = buildHarness();

		const response = await request(harness.server).get("/admin/mfa");

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
	});

	it("sends a request carrying only the service token to /login", async () => {
		const harness = buildHarness();

		const response = await request(harness.server)
			.get("/admin/mfa")
			.set("x-service-token", harness.serviceToken);

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
	});

	it("refuses a signed-in reader who is not an admin", async () => {
		const harness = buildHarness();
		await harness.auth.createUser({ email: USER_EMAIL, password: USER_PASSWORD });
		const agent = await loginAs({ server: harness.server, email: USER_EMAIL, password: USER_PASSWORD });

		const response = await agent.get("/admin/mfa");

		assert.equal(response.status, 403);
	});

	it("shows an admin the code form without caching it", async () => {
		const harness = buildHarness();
		const agent = await signedInAdmin(harness);

		const response = await agent.get("/admin/mfa");

		assert.equal(response.status, 200);
		assert.equal(response.headers["cache-control"], "no-store");
		const document = new JSDOM(response.text).window.document;
		assert.equal(document.body.classList.contains("page-admin-mfa"), true);
		const form = document.querySelector('[data-test-form="admin-mfa"]');
		assert(form, "the challenge form must be rendered");
		assert.equal(form.getAttribute("method"), "post");
		assert.equal(form.getAttribute("action"), "/admin/mfa");
		const input = form.querySelector('input[name="code"]');
		assert(input, "the code input must be rendered");
		assert.equal(input.getAttribute("inputmode"), "numeric");
		assert.equal(input.getAttribute("autocomplete"), "one-time-code");
		assert.equal(input.getAttribute("maxlength"), "6");
		const label = form.querySelector(`label[for="${input.getAttribute("id")}"]`);
		assert(label, "the code input must have a visible label");
	});
});

describe("POST /admin/mfa", () => {
	it("lets an admin who enters the current code into /admin", async () => {
		const harness = buildHarness();
		const agent = await signedInAdmin(harness);

		const challenge = await agent.post("/admin/mfa").type("form").send({ code: harness.currentCode() });

		assert.equal(challenge.status, 303);
		assert.equal(challenge.headers.location, "/admin");
		const admin = await agent.get("/admin");
		assert.equal(admin.status, 200);
	});

	it("marks the session in epoch seconds, like the row's expiresAt", async () => {
		const fixedNow = new Date("2026-11-13T04:00:07Z");
		const harness = buildHarness({ now: () => fixedNow });
		await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
		const agent = request.agent(harness.server);
		const login = await agent.post("/login").type("form").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
		const sessionId = readCookie([login.headers["set-cookie"]].flat().join("; "), SESSION_COOKIE_NAME);
		assert(sessionId, "login must set the session cookie");

		await agent.post("/admin/mfa").type("form").send({ code: harness.currentCode() });

		const markedAt = await harness.auth.findSessionAdminMfaVerifiedAt(sessionId);
		assert.equal(markedAt, Math.floor(fixedNow.getTime() / 1000));
	});

	it("shows the form again with an error for a wrong code and keeps /admin closed", async () => {
		const harness = buildHarness();
		const agent = await signedInAdmin(harness);

		const challenge = await agent
			.post("/admin/mfa")
			.type("form")
			.send({ code: harness.wrongCode() });

		assert.equal(challenge.status, 422);
		assert.equal(challengeErrorOf(challenge.text), "That code did not match. Enter the current code from your authenticator app.");
		const admin = await agent.get("/admin");
		assert.equal(admin.status, 303);
		assert.equal(admin.headers.location, "/admin/mfa");
	});

	it("shows the same error for a code that is not six digits", async () => {
		const harness = buildHarness();
		const agent = await signedInAdmin(harness);

		const challenge = await agent.post("/admin/mfa").type("form").send({ code: "12ab" });

		assert.equal(challenge.status, 422);
		assert.equal(challengeErrorOf(challenge.text), "That code did not match. Enter the current code from your authenticator app.");
	});

	it("refuses an admin who has no configured secret, whatever the code", async () => {
		const harness = buildHarness({ totpSecrets: new Map() });
		const agent = await signedInAdmin(harness);

		const challenge = await agent.post("/admin/mfa").type("form").send({ code: harness.currentCode() });

		assert.equal(challenge.status, 422);
		const admin = await agent.get("/admin");
		assert.equal(admin.headers.location, "/admin/mfa");
	});

	it("marks only the session that passed the challenge", async () => {
		const harness = buildHarness();
		const firstAgent = await signedInAdmin(harness);
		await firstAgent.post("/admin/mfa").type("form").send({ code: harness.currentCode() });
		const secondAgent = await loginAs({ server: harness.server, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

		const response = await secondAgent.get("/admin");

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/admin/mfa");
	});

	it("answers 429 once the attempts are spent, even for the correct code", async () => {
		const harness = buildHarness({ secondFactorAttemptRule: { limit: 2, windowSeconds: 900 } });
		const agent = await signedInAdmin(harness);
		const wrongCode = harness.wrongCode();
		await agent.post("/admin/mfa").type("form").send({ code: wrongCode });
		await agent.post("/admin/mfa").type("form").send({ code: wrongCode });

		const response = await agent.post("/admin/mfa").type("form").send({ code: harness.currentCode() });

		assert.equal(response.status, 429);
		assert.equal(typeof response.headers["retry-after"], "string");
		const admin = await agent.get("/admin");
		assert.equal(admin.headers.location, "/admin/mfa");
	});
});
