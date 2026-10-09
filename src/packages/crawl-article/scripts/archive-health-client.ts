import assert from "node:assert";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { parseHTML } from "linkedom";
import { z } from "zod";

const SIREN = "application/vnd.siren+json";
const SirenCollection = z.object({ actions: z.array(z.object({ name: z.string(), href: z.string() })) });
const TokenGrant = z.object({ access_token: z.string(), refresh_token: z.string() });
const CANARY_OAUTH_CLIENT_ID = "hutch-chrome-extension";

type HealthFetch = (url: string, init: RequestInit) => Promise<Response>;

export function initArchiveHealthClient(deps: {
	origin: string;
	email: string;
	password: string;
	fetch: HealthFetch;
}) {
	const origin = new URL(deps.origin).origin;
	const cookies = new Map<string, string>();

	const sameOriginUrl = (href: string): string => {
		const url = new URL(href, origin);
		assert.equal(url.origin, origin, "canary form or redirect must stay on the configured origin");
		return url.toString();
	};

	const request = async (input: { href: string; method: "GET" | "POST"; body?: URLSearchParams | FormData; accept?: string; authorization?: string }): Promise<Response> => {
		const headers: Record<string, string> = { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; ") };
		if (input.accept !== undefined) headers.accept = input.accept;
		if (input.authorization !== undefined) headers.authorization = input.authorization;
		const response = await deps.fetch(sameOriginUrl(input.href), {
			method: input.method,
			redirect: "manual",
			headers,
			body: input.body,
		});
		for (const cookie of response.headers.getSetCookie()) {
			const pair = cookie.split(";", 1)[0];
			const separator = pair.indexOf("=");
			assert(separator > 0, "login returned an invalid cookie");
			const name = pair.slice(0, separator);
			cookies.set(name, pair.slice(separator + 1));
		}
		return response;
	};

	const readPage = async (href: string): Promise<string> => {
		const response = await request({ href, method: "GET" });
		assert.equal(response.status, 200, "canary account page must load without an auth redirect");
		return response.text();
	};

	const formFrom = (input: { html: string; selector: string }) => {
		const form = parseHTML(input.html).document.querySelector(input.selector);
		assert(form, `canary page must publish ${input.selector}`);
		assert.equal(form.getAttribute("method")?.toUpperCase(), "POST", "canary form must use POST");
		const action = form.getAttribute("action");
		assert(action, "canary form must publish its action");
		const body = new URLSearchParams();
		for (const field of form.querySelectorAll('input[name][type="hidden"]')) {
			const name = field.getAttribute("name");
			const value = field.getAttribute("value");
			assert(name && value !== null, "hidden form fields must have a name and value");
			body.set(name, value);
		}
		return { href: sameOriginUrl(action), body };
	};

	const login = async (): Promise<void> => {
		const form = formFrom({ html: await readPage("/login"), selector: '[data-test-form="login"]' });
		form.body.set("email", deps.email);
		form.body.set("password", deps.password);
		const response = await request({ ...form, method: "POST" });
		assert.equal(response.status, 303, "canary account login failed; configure an existing verified account");
		await response.text();
	};

	const save = async (url: string): Promise<string> => {
		const form = formFrom({ html: await readPage("/queue"), selector: '[data-test-form="save-article"]' });
		form.body.set("url", url);
		const response = await request({ ...form, method: "POST" });
		assert.equal(response.status, 303, "canary save must use the normal accepted form response");
		const location = response.headers.get("location");
		assert(location, "canary save must redirect to its readlist");
		const destination = new URL(sameOriginUrl(location));
		assert(!destination.searchParams.has("error_code"), "canary save was refused");
		const header = response.headers.get("x-readplace-save-attempt-id");
		assert(header, "accepted save must return its save attempt id");
		const attempt = z.uuid().parse(header);
		await response.text();
		return attempt;
	};

	const grantAccessToken = async (): Promise<{ accessToken: string; refreshToken: string }> => {
		const verifier = randomBytes(32).toString("base64url");
		const redirectUri = new URL("/oauth/callback", origin).toString();
		const authorize = new URLSearchParams({
			client_id: CANARY_OAUTH_CLIENT_ID,
			redirect_uri: redirectUri,
			response_type: "code",
			code_challenge: createHash("sha256").update(verifier).digest("base64url"),
			code_challenge_method: "S256",
			state: randomUUID(),
		});
		const consent = formFrom({ html: await readPage(`/oauth/authorize?${authorize}`), selector: 'form[action^="/oauth/authorize"]' });
		consent.body.set("action", "approve");
		const approved = await request({ ...consent, method: "POST" });
		const location = approved.headers.get("location");
		assert(location, "canary OAuth consent must redirect to its callback");
		await approved.text();
		const code = new URL(sameOriginUrl(location)).searchParams.get("code");
		assert(code, "canary OAuth consent must return an authorization code");
		const exchanged = await request({
			href: "/oauth/token",
			method: "POST",
			body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: CANARY_OAUTH_CLIENT_ID, code_verifier: verifier }),
		});
		assert.equal(exchanged.status, 200, "canary OAuth token exchange must succeed");
		const grant = TokenGrant.parse(await exchanged.json());
		return { accessToken: grant.access_token, refreshToken: grant.refresh_token };
	};

	const upload = async (input: { url: string; title: string; html: string }): Promise<void> => {
		const grant = await grantAccessToken();
		try {
			const siren = { accept: SIREN, authorization: `Bearer ${grant.accessToken}` };
			const collection = await request({ href: "/queue", method: "GET", ...siren });
			assert.equal(collection.status, 200, "canary Siren collection must load with its granted token");
			const action = SirenCollection.parse(await collection.json()).actions.find((candidate) => candidate.name === "save-content");
			assert(action, "authenticated Siren collection must advertise save-content");
			const body = new FormData();
			body.set("url", input.url);
			body.set("title", input.title);
			body.set("mediaType", "text/html");
			body.set("content", new Blob([input.html], { type: "text/html" }), "article.html");
			const response = await request({ href: action.href, method: "POST", body, ...siren });
			assert.equal(response.status, 201, "canary upload must be accepted");
			await response.text();
		} finally {
			const revoked = await request({ href: "/oauth/revoke", method: "POST", body: new URLSearchParams({ token: grant.refreshToken }) });
			assert.equal(revoked.status, 200, "canary must revoke the token it granted itself");
			await revoked.text();
		}
	};

	const findOnlyCard = async (originalUrl: string): Promise<string | undefined> => {
		const document = parseHTML(await readPage("/queue")).document;
		const originalId = ArticleResourceUniqueId.parse(originalUrl).value;
		const cards = [...document.querySelectorAll("[data-test-article]")].filter((card) => {
			const href = card.querySelector("[data-test-article-url]")?.getAttribute("href");
			return href !== null && href !== undefined && ArticleResourceUniqueId.parse(href).value === originalId;
		});
		assert(cards.length <= 1, "archive and direct saves must produce at most one original-identity card");
		if (cards.length === 0) return undefined;
		const id = cards[0].getAttribute("data-test-article");
		assert(id, "saved card must expose its identity");
		const latest = document.querySelector("#latest-saved[data-test-article]");
		assert.equal(latest?.getAttribute("data-test-article"), id, "the accepted save must put the original card at the top, not create another wrapper or redirected card");
		return id;
	};

	return { login, save, upload, findOnlyCard };
}
