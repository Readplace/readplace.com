import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../test-app";

const CLIENT_ID = "obsidian-plugin";
const REDIRECT_URI = "http://127.0.0.1:3000/oauth/obsidian";
const STATE = "handoff-state";

const useApp = useTestServer();

type Harness = ReturnType<typeof useApp>;
type Agent = Awaited<ReturnType<typeof loginAgent>>;

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

function generatePKCE() {
	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	return { verifier, challenge };
}

function buildHarness(): Harness {
	return useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
}

function authorizeFields(challenge: string) {
	return {
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: STATE,
	};
}

function answerConsent(agent: Agent, params: { challenge: string; action: "approve" | "deny" }) {
	return agent
		.post("/oauth/authorize")
		.type("form")
		.send({ ...authorizeFields(params.challenge), action: params.action });
}

async function approvedRedirect(agent: Agent, challenge: string): Promise<URL> {
	const response = await answerConsent(agent, { challenge, action: "approve" });
	expect(response.status).toBe(302);
	return new URL(response.headers.location);
}

function returnHref(doc: Document): string | null {
	const link = doc.querySelector("[data-test-return]");
	assert(link, "the return link must render");
	return link.getAttribute("href");
}

function exchangeCode(harness: Harness, params: { code: string; verifier: string }) {
	return request(harness.server).post("/oauth/token").type("form").send({
		grant_type: "authorization_code",
		code: params.code,
		redirect_uri: REDIRECT_URI,
		client_id: CLIENT_ID,
		code_verifier: params.verifier,
	});
}

describe("Obsidian sign-in handoff (GET /oauth/obsidian)", () => {
	it("shows the first-party consent page to a signed-in reader", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/oauth/authorize").query(authorizeFields(generatePKCE().challenge));

		expect(response.status).toBe(200);
		const title = parse(response.text).querySelector(".oauth-authorize__title");
		assert(title, "the consent title must render");
		expect(title.textContent?.trim()).toBe("Connect Readplace for Obsidian");
	});

	it("sends an approval to the handoff page with the code and state", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);

		const location = await approvedRedirect(agent, generatePKCE().challenge);

		expect(location.href.startsWith(`${REDIRECT_URI}?`)).toBe(true);
		expect(location.searchParams.get("code")).toEqual(expect.any(String));
		expect(location.searchParams.get("state")).toBe(STATE);
	});

	it("renders the return link, the copy box and the protective headers for an approved code", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const location = await approvedRedirect(agent, generatePKCE().challenge);
		const code = location.searchParams.get("code");
		assert(code, "the redirect must carry a code");

		const response = await request(harness.server).get(`${location.pathname}${location.search}`);

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.headers["referrer-policy"]).toBe("no-referrer");
		const doc = parse(response.text);
		expect(returnHref(doc)).toBe(`obsidian://readplace-auth?code=${code}&state=${STATE}`);
		expect(doc.querySelector("h1")?.textContent).toBe("Sign-in approved");
		expect(doc.querySelector("[data-test-code]")?.textContent).toBe(code);
		const copy = doc.querySelector("[data-oauth-copy]");
		assert(copy, "the copy button must render");
		expect(copy.getAttribute("data-oauth-text")).toBe(code);
		expect(copy.hasAttribute("hidden")).toBe(true);
		expect(copy.closest(".oauth-obsidian__copy-field")?.querySelector("[data-test-code]")).not.toBeNull();
		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
		expect(response.text.split(code).length - 1).toBe(3);
		expect(response.text).toContain('<script src="/client-dist/oauth-obsidian-handoff.client.js" defer></script>');
	});

	it("exchanges the handed-off code for tokens with the right verifier", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const pkce = generatePKCE();
		const code = (await approvedRedirect(agent, pkce.challenge)).searchParams.get("code");
		assert(code, "the redirect must carry a code");

		const response = await exchangeCode(harness, { code, verifier: pkce.verifier });

		expect(response.status).toBe(200);
		expect(response.body.access_token).toEqual(expect.any(String));
		expect(response.body.refresh_token).toEqual(expect.any(String));
	});

	it("refuses the handed-off code with a wrong verifier", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);
		const code = (await approvedRedirect(agent, generatePKCE().challenge)).searchParams.get("code");
		assert(code, "the redirect must carry a code");

		const response = await exchangeCode(harness, { code, verifier: generatePKCE().verifier });

		expect(response.status).toBe(400);
	});

	it("hands a denial back to Obsidian with the error and state", async () => {
		const harness = buildHarness();
		const agent = await loginAgent(harness.server, harness.auth);

		const denied = await answerConsent(agent, { challenge: generatePKCE().challenge, action: "deny" });

		expect(denied.status).toBe(302);
		expect(denied.headers.location).toBe(`${REDIRECT_URI}?error=access_denied&state=${STATE}`);
		const location = new URL(denied.headers.location);
		const response = await request(harness.server).get(`${location.pathname}${location.search}`);
		expect(response.status).toBe(200);
		const doc = parse(response.text);
		expect(returnHref(doc)).toBe(`obsidian://readplace-auth?error=access_denied&state=${STATE}`);
		expect(doc.querySelector("h1")?.textContent).toBe("Sign-in cancelled");
	});

	it("answers 400 when the query has neither a code nor an error", async () => {
		const harness = buildHarness();

		const response = await request(harness.server).get("/oauth/obsidian");

		expect(response.status).toBe(400);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(parse(response.text).querySelector("h1")?.textContent).toBe("This link is incomplete");
	});

	it("copies only the code and state into the return link", async () => {
		const harness = buildHarness();

		const response = await request(harness.server).get(
			"/oauth/obsidian?code=abc&state=x&error=access_denied&error_description=ignored",
		);

		expect(returnHref(parse(response.text))).toBe("obsidian://readplace-auth?code=abc&state=x");
	});
});
