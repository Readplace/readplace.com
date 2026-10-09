import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { initArchiveHealthClient } from "./archive-health-client";

const LOGIN = '<form method="POST" action="/login?source=canary" data-test-form="login"><input type="hidden" name="csrf" value="token"></form>';
const SAVE = '<form method="POST" action="/queue/save?source=canary" data-test-form="save-article"></form>';
const ATTEMPT = "12c9f733-a806-4734-9d76-2d466e41d473";

function clientFor(responses: Response[]) {
	const calls: { url: string; init: RequestInit }[] = [];
	const client = initArchiveHealthClient({
		origin: "https://readplace.example",
		email: "canary@example.com",
		password: "canary-password",
		fetch: async (url, init) => {
			calls.push({ url, init });
			const response = responses.shift();
			assert(response, "unexpected request");
			return response;
		},
	});
	return { client, calls };
}

it("logs in once with existing credentials, keeps its session and discovers the normal save action", async () => {
	const { client, calls } = clientFor([
		new Response(LOGIN),
		new Response("", { status: 303, headers: { location: "/queue", "set-cookie": "hutch_sid=canary-session; HttpOnly; Secure" } }),
		new Response(SAVE),
		new Response("", { status: 303, headers: { location: "/queue#latest-saved", "x-readplace-save-attempt-id": ATTEMPT } }),
	]);
	await client.login();
	expect(await client.save("https://web.archive.org/web/2008/https://example.com/article")).toBe(ATTEMPT);
	expect(calls.map(({ url }) => url)).toEqual([
		"https://readplace.example/login", "https://readplace.example/login?source=canary",
		"https://readplace.example/queue", "https://readplace.example/queue/save?source=canary",
	]);
	expect(calls[1].init.body?.toString()).toBe("csrf=token&email=canary%40example.com&password=canary-password");
	expect(calls[3].init).toMatchObject({ method: "POST", redirect: "manual", headers: { cookie: "hutch_sid=canary-session" } });
});

const CONSENT = '<form method="POST" action="/oauth/authorize?utm_source=oauth-authorize"><input type="hidden" name="client_id" value="hutch-chrome-extension"><input type="hidden" name="code_challenge" value="challenge"></form>';
const loggedIn = () => [
	new Response(LOGIN),
	new Response("", { status: 303, headers: { location: "/queue", "set-cookie": "hutch_sid=canary-session; HttpOnly; Secure" } }),
];
const granted = () => [
	new Response(CONSENT),
	new Response("", { status: 302, headers: { location: "https://readplace.example/oauth/callback?code=auth-code&state=s" } }),
	new Response(JSON.stringify({ access_token: "access-token", refresh_token: "refresh-token", token_type: "Bearer", expires_in: 3599 })),
];
const UPLOAD = { url: "https://readplace.com/crawl-canary/upload/run", title: "Upload", html: "<p>marker</p>" };

it("uploads the reader's page through the Siren save-content action with a token its session grants, then revokes the token", async () => {
	const { client, calls } = clientFor([
		...loggedIn(),
		...granted(),
		new Response(JSON.stringify({ actions: [{ name: "save", href: "/queue/save" }, { name: "save-content", href: "/queue/save-content" }] })),
		new Response("{}", { status: 201 }),
		new Response("{}"),
	]);
	await client.login();
	await client.upload(UPLOAD);

	const authorize = new URL(calls[2].url);
	expect([authorize.pathname, authorize.searchParams.get("client_id"), authorize.searchParams.get("redirect_uri"), authorize.searchParams.get("response_type"), authorize.searchParams.get("code_challenge_method")])
		.toEqual(["/oauth/authorize", "hutch-chrome-extension", "https://readplace.example/oauth/callback", "code", "S256"]);
	expect(authorize.searchParams.get("state")).toEqual(expect.any(String));
	expect(calls[3]).toMatchObject({ url: "https://readplace.example/oauth/authorize?utm_source=oauth-authorize", init: { method: "POST", headers: { cookie: "hutch_sid=canary-session" } } });
	expect(new URLSearchParams(calls[3].init.body?.toString()).get("action")).toBe("approve");
	const token = new URLSearchParams(calls[4].init.body?.toString());
	expect([calls[4].url, token.get("grant_type"), token.get("code"), token.get("redirect_uri"), token.get("client_id")])
		.toEqual(["https://readplace.example/oauth/token", "authorization_code", "auth-code", "https://readplace.example/oauth/callback", "hutch-chrome-extension"]);
	const verifier = token.get("code_verifier");
	assert(verifier);
	expect(createHash("sha256").update(verifier).digest("base64url")).toBe(authorize.searchParams.get("code_challenge"));

	const bearer = { cookie: "hutch_sid=canary-session", accept: "application/vnd.siren+json", authorization: "Bearer access-token" };
	expect(calls.slice(5, 7).map(({ url, init }) => [url, init.method, init.headers])).toEqual([
		["https://readplace.example/queue", "GET", bearer],
		["https://readplace.example/queue/save-content", "POST", bearer],
	]);
	const body = calls[6].init.body;
	assert(body instanceof FormData);
	expect([body.get("url"), body.get("title"), body.get("mediaType")]).toEqual(["https://readplace.com/crawl-canary/upload/run", "Upload", "text/html"]);
	const content = body.get("content");
	assert(content instanceof Blob);
	expect(await content.text()).toBe("<p>marker</p>");
	expect([calls[7].url, calls[7].init.method, calls[7].init.body?.toString()]).toEqual(["https://readplace.example/oauth/revoke", "POST", "token=refresh-token"]);
});

it.each([
	{ label: "the Siren collection refuses the token", responses: () => [new Response("", { status: 401 })], error: "Siren collection must load" },
	{ label: "save-content is not advertised", responses: () => [new Response(JSON.stringify({ actions: [] }))], error: "must advertise save-content" },
	{ label: "the upload is refused", responses: () => [new Response(JSON.stringify({ actions: [{ name: "save-content", href: "/queue/save-content" }] })), new Response("", { status: 402 })], error: "upload must be accepted" },
])("fails the upload when $label, still revoking its token", async ({ responses, error }) => {
	const { client, calls } = clientFor([...granted(), ...responses(), new Response("{}")]);
	await expect(client.upload(UPLOAD)).rejects.toThrow(error);
	expect(calls.at(-1)?.url).toBe("https://readplace.example/oauth/revoke");
});

it.each([
	{ label: "consent does not return an authorization code", responses: () => [new Response(CONSENT), new Response("", { status: 302, headers: { location: "https://readplace.example/oauth/callback?error=invalid_request" } })], error: "consent must return an authorization code" },
	{ label: "consent does not redirect", responses: () => [new Response(CONSENT), new Response("Bad Request", { status: 400 })], error: "consent must redirect" },
	{ label: "the token exchange is refused", responses: () => [new Response(CONSENT), new Response("", { status: 302, headers: { location: "https://readplace.example/oauth/callback?code=auth-code" } }), new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })], error: "token exchange must succeed" },
])("fails the upload before saving when $label", async ({ responses, error }) => {
	const { client, calls } = clientFor(responses());
	await expect(client.upload(UPLOAD)).rejects.toThrow(error);
	expect(calls.map(({ url }) => new URL(url).pathname)).not.toContain("/queue/save-content");
});

it("refuses a cross-origin login action before sending credentials", async () => {
	const { client, calls } = clientFor([new Response(LOGIN.replace("/login?source=canary", "https://other.example/login"))]);
	await expect(client.login()).rejects.toThrow("configured origin");
	expect(calls).toHaveLength(1);
});

it("fails when login does not reach an authenticated readlist", async () => {
	const { client } = clientFor([new Response(LOGIN), new Response("Invalid password", { status: 401 })]);
	await expect(client.login()).rejects.toThrow("canary account login failed");
});

it("rejects a save refusal even when it returns a redirect", async () => {
	const { client } = clientFor([new Response(SAVE), new Response("", { status: 303, headers: { location: "/queue?error_code=save_failed", "x-readplace-save-attempt-id": ATTEMPT } })]);
	await expect(client.save("https://example.com/article")).rejects.toThrow("save was refused");
});

it("requires correlation from the accepted save rather than treating a redirect as completion", async () => {
	const { client } = clientFor([new Response(SAVE), new Response("", { status: 303, headers: { location: "/queue" } })]);
	await expect(client.save("https://example.com/article")).rejects.toThrow("accepted save must return its save attempt id");
});

it("checks the original card identity and rejects duplicate original cards", async () => {
	const card = '<article data-test-article="original-card" id="latest-saved"><a data-test-article-url href="http://example.com/article">Original</a></article>';
	const { client } = clientFor([new Response(card), new Response(card + card)]);
	expect(await client.findOnlyCard("https://example.com/article")).toBe("original-card");
	await expect(client.findOnlyCard("https://example.com/article")).rejects.toThrow("at most one");
});

it("cannot satisfy original identity with an old card keyed on the archive URL", async () => {
	const { client } = clientFor([new Response('<article data-test-article="old-card"><a data-test-article-url href="https://web.archive.org/web/2008/https://example.com/article">Archive</a></article>')]);
	expect(await client.findOnlyCard("https://example.com/article")).toBeUndefined();
});

it("does not mistake an unchanged original card for a successful direct save when the save created a redirected card", async () => {
	const { client } = clientFor([new Response('<article data-test-article="wrong-card" id="latest-saved"><a data-test-article-url href="https://example.com/">Homepage</a></article><article data-test-article="original-card"><a data-test-article-url href="https://example.com/article">Original</a></article>')]);
	await expect(client.findOnlyCard("https://example.com/article")).rejects.toThrow("accepted save must put the original card at the top");
});
