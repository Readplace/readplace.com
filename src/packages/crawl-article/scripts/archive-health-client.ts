import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { parseHTML } from "linkedom";
import { z } from "zod";

const SIREN = "application/vnd.siren+json";
const SirenCollection = z.object({ actions: z.array(z.object({ name: z.string(), href: z.string() })) });

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

	const request = async (input: { href: string; method: "GET" | "POST"; body?: URLSearchParams | FormData; accept?: string }): Promise<Response> => {
		const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
		const response = await deps.fetch(sameOriginUrl(input.href), {
			method: input.method,
			redirect: "manual",
			headers: input.accept === undefined ? { cookie } : { cookie, accept: input.accept },
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

	const upload = async (input: { url: string; title: string; html: string }): Promise<void> => {
		const collection = await request({ href: "/queue", method: "GET", accept: SIREN });
		assert.equal(collection.status, 200, "canary Siren collection must load without an auth redirect");
		const action = SirenCollection.parse(await collection.json()).actions.find((candidate) => candidate.name === "save-content");
		assert(action, "authenticated Siren collection must advertise save-content");
		const body = new FormData();
		body.set("url", input.url);
		body.set("title", input.title);
		body.set("mediaType", "text/html");
		body.set("content", new Blob([input.html], { type: "text/html" }), "article.html");
		const response = await request({ href: action.href, method: "POST", body, accept: SIREN });
		assert.equal(response.status, 201, "canary upload must be accepted");
		await response.text();
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
