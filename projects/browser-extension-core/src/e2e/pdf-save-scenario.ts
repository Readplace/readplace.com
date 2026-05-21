import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { initSirenReadingList } from "../reading-list/siren-reading-list";

/**
 * Pinned OAuth client for the e2e PDF scenario. The Chrome extension registers
 * under the same id, and the test-fixtures provider has a corresponding entry
 * (src/packages/test-fixtures/src/providers/oauth/oauth-clients.ts).
 */
const CLIENT_ID = "hutch-chrome-extension";

/**
 * Any 127.0.0.1:* callback passes validateRedirectUri (oauth-clients.ts:40), so
 * a fixed port works against both the local e2e server (which binds 127.0.0.1)
 * and staging (which never sees the callback — we extract the code from the
 * authorize response's Location header without following the redirect).
 */
const REDIRECT_URI = "http://127.0.0.1:3000/oauth/callback";

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256")
		.update(codeVerifier)
		.digest("base64url");
	return { codeVerifier, codeChallenge };
}

/**
 * Splits a `set-cookie` response header (Node's `fetch` joins multiple cookies
 * with `, ` even though commas are legal in cookie attribute values like
 * `expires=Wed, 09 Jun 2027`). Splits on `, ` only when followed by a token=,
 * which is the leading shape of a new cookie. Returns just the `name=value`
 * pair of each cookie, suitable for re-sending via the `Cookie` header.
 */
function parseSetCookieHeader(setCookieHeader: string): string[] {
	const cookies: string[] = [];
	const parts = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
	for (const part of parts) {
		const semiIndex = part.indexOf(";");
		const nameValue = semiIndex === -1 ? part.trim() : part.slice(0, semiIndex).trim();
		if (nameValue.length > 0) cookies.push(nameValue);
	}
	return cookies;
}

/**
 * Logs in via the SSR /login form and exchanges the session for an OAuth
 * access token via the same authorize → token flow the extension's
 * background script runs. Returns a Bearer token suitable for
 * `Authorization: Bearer …` on Siren routes.
 *
 * Mirrors projects/hutch/src/runtime/web/api/save-article-via-oauth.integration.ts
 * but uses node's global fetch (no supertest) so it works against any base URL,
 * local or staging.
 */
export async function obtainAccessToken(params: {
	serverUrl: string;
	email: string;
	password: string;
	fetchFn?: typeof fetch;
}): Promise<string> {
	const fetchFn = params.fetchFn ?? globalThis.fetch;

	const loginResponse = await fetchFn(`${params.serverUrl}/login`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			email: params.email,
			password: params.password,
		}).toString(),
		redirect: "manual",
	});
	assert(
		loginResponse.status >= 200 && loginResponse.status < 400,
		`POST /login returned ${loginResponse.status}`,
	);
	const setCookie = loginResponse.headers.get("set-cookie");
	assert(setCookie, "POST /login did not return a session cookie");
	const cookieHeader = parseSetCookieHeader(setCookie).join("; ");

	const { codeVerifier, codeChallenge } = generatePkce();
	const state = randomBytes(16).toString("base64url");
	const authorizeResponse = await fetchFn(`${params.serverUrl}/oauth/authorize`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Cookie: cookieHeader,
		},
		body: new URLSearchParams({
			client_id: CLIENT_ID,
			redirect_uri: REDIRECT_URI,
			response_type: "code",
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
			state,
			action: "approve",
		}).toString(),
		redirect: "manual",
	});
	const location = authorizeResponse.headers.get("location");
	assert(
		location,
		`POST /oauth/authorize must redirect (got ${authorizeResponse.status})`,
	);
	const code = new URL(location).searchParams.get("code");
	assert(code, `authorize redirect missing code: ${location}`);

	const tokenResponse = await fetchFn(`${params.serverUrl}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT_URI,
			client_id: CLIENT_ID,
			code_verifier: codeVerifier,
		}).toString(),
	});
	assert.equal(
		tokenResponse.status,
		200,
		`POST /oauth/token returned ${tokenResponse.status}`,
	);
	const TokenResponse = z.object({ access_token: z.string() });
	const tokenBody = TokenResponse.parse(await tokenResponse.json());
	return tokenBody.access_token;
}

export interface PdfSaveScenarioConfig {
	/** Origin of the readplace.com server under test (local e2e or staging). */
	serverUrl: string;
	/** Pre-provisioned test user; local harness creates this via POST /e2e/users. */
	email: string;
	password: string;
	/** A URL that responds with Content-Type: application/pdf. The extension's
	 * save-article path (no rawHtml) will be invoked with this URL. */
	pdfUrl: string;
	/** Substring expected in the saved article's title after ComprehensiveCrawl
	 * extracts the PDF (local: the stub's marker; staging: a fragment of the
	 * real document title from vision OCR). */
	expectedTitleSubstring: string;
	/** Override globalThis.fetch — useful for staging tests that need to disable
	 * keep-alive or add a proxy. Defaults to global fetch. */
	fetchFn?: typeof fetch;
	/** How long to poll for the extracted title before failing. PDF OCR via
	 * DeepInfra in staging can take 20–30s; default of 90s leaves headroom. */
	pollTimeoutMs?: number;
	/** Interval between polls of the Siren collection. */
	pollIntervalMs?: number;
}

/**
 * End-to-end contract test for the extension's save flow on PDF URLs.
 *
 * Drives the same `initSirenReadingList` walker the production extension uses,
 * exercising the URL-only `save-article` fallback (no rawHtml) that fires
 * every time the popup is opened on a tab whose body the content script can't
 * capture — which is every PDF tab, because browsers render PDFs in a native
 * viewer where `document.documentElement.outerHTML` is unreachable.
 *
 * The scenario pins the contract:
 *   - extension follows Siren entry point and discovers `save-article` by name
 *   - server accepts the URL, kicks off SimpleCrawl → ComprehensiveCrawl
 *   - PDF branch (crawl-article.ts:190) runs extractPdf
 *   - selector promotes the article to `ready` and updates the title
 *   - re-walking Siren shows the updated title within the poll window
 */
export async function runPdfSaveScenario(
	config: PdfSaveScenarioConfig,
): Promise<void> {
	const fetchFn = config.fetchFn ?? globalThis.fetch;
	const pollTimeoutMs = config.pollTimeoutMs ?? 90_000;
	const pollIntervalMs = config.pollIntervalMs ?? 1_000;

	const accessToken = await obtainAccessToken({
		serverUrl: config.serverUrl,
		email: config.email,
		password: config.password,
		fetchFn,
	});

	const { saveUrl, getAllItems } = initSirenReadingList({
		serverUrl: config.serverUrl,
		getAccessToken: async () => accessToken,
		fetchFn,
		onUnauthorized: async () => {
			throw new Error("Unauthorized while running pdf-save scenario");
		},
	});

	const saveResult = await saveUrl({
		url: config.pdfUrl,
		title: "",
	});
	assert(saveResult.ok, `saveUrl failed: ${JSON.stringify(saveResult)}`);
	const savedId = saveResult.item.id;

	const deadline = Date.now() + pollTimeoutMs;
	let lastTitle = saveResult.item.title;
	while (Date.now() < deadline) {
		const items = await getAllItems();
		const current = items.find((item) => item.id === savedId);
		assert(
			current,
			`Saved article id ${savedId} disappeared from the queue mid-poll`,
		);
		lastTitle = current.title;
		if (current.title.includes(config.expectedTitleSubstring)) return;
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}

	throw new Error(
		`Timed out after ${pollTimeoutMs}ms waiting for extracted title to contain "${config.expectedTitleSubstring}". Last observed title: "${lastTitle}"`,
	);
}
