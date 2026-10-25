import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import matter from "gray-matter";
import request from "supertest";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeSummaryProvider,
} from "@packages/test-fixtures";
import { type TestAppHarness, useTestServer } from "../../test-app";
import { SIREN_MEDIA_TYPE } from "./siren";

const REDIRECT_URI = "http://127.0.0.1:8765/callback";
const READLIST_LABEL = "Automator";
const SUMMARISED_URL = "https://example.com/automator-summarised";
const READ_URL = "https://example.com/automator-read";
const PLAIN_URL = "https://example.com/automator-plain";
const SUMMARY = "Automator summary.";

interface Action {
	name: string;
	href: string;
	method: string;
	type?: string;
	fields?: { name: string; value?: string }[];
}

interface Link {
	rel: string[];
	href: string;
}

interface ArticleEntity {
	properties: { id: string; url: string; title: string };
	links: Link[];
	actions: Action[];
}

function generatePkce() {
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	return { codeVerifier, codeChallenge };
}

async function registerClient(harness: TestAppHarness): Promise<string> {
	const registration = await request(harness.server)
		.post("/oauth/register")
		.send({ redirect_uris: [REDIRECT_URI], client_name: "Readlist automator" });
	assert.equal(registration.status, 201);
	return registration.body.client_id;
}

async function obtainAccessToken(harness: TestAppHarness, clientId: string): Promise<string> {
	await harness.auth.createUser({ email: "automator@example.com", password: "password123" });
	const agent = request.agent(harness.server);
	await agent.post("/login").type("form").send({ email: "automator@example.com", password: "password123" });

	const { codeVerifier, codeChallenge } = generatePkce();
	const grant = {
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		state: "automator",
	};
	const consent = await agent.get("/oauth/authorize").query({ ...grant, scope: "queue" });
	assert.equal(consent.status, 200);

	const approval = await agent.post("/oauth/authorize").type("form").send({ ...grant, action: "approve" });
	assert.equal(approval.status, 302);
	const code = new URL(approval.headers.location).searchParams.get("code");
	assert(code, "approving must redirect with a code");

	const exchange = await request(harness.server).post("/oauth/token").type("form").send({
		grant_type: "authorization_code",
		code,
		redirect_uri: REDIRECT_URI,
		client_id: clientId,
		code_verifier: codeVerifier,
	});
	assert.equal(exchange.status, 200);
	assert(exchange.body.access_token, "the token endpoint must return an access_token");
	return exchange.body.access_token;
}

function sirenGet(harness: TestAppHarness, params: { token: string; path: string }) {
	return request(harness.server)
		.get(params.path)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`)
		.redirects(0);
}

async function followRedirects(
	harness: TestAppHarness,
	params: { token: string; response: request.Response },
): Promise<request.Response> {
	let response = params.response;
	while (response.status >= 300 && response.status < 400) {
		response = await sirenGet(harness, { token: params.token, path: response.headers.location });
	}
	return response;
}

async function readCollection(harness: TestAppHarness, params: { token: string; path: string }) {
	const collection = await followRedirects(harness, { token: params.token, response: await sirenGet(harness, params) });
	assert.equal(collection.status, 200);
	return collection;
}

function actionNamed(entity: { actions?: Action[] }, name: string): Action {
	const action = entity.actions?.find((candidate) => candidate.name === name);
	assert(action, `expected a ${name} action`);
	return action;
}

function linkHref(entity: { links: Link[] }, rel: string): string {
	const link = entity.links.find((candidate) => candidate.rel.includes(rel));
	assert(link, `expected a ${rel} link`);
	return link.href;
}

function currentHref(entries: { rel: string; href: string }[]): string {
	const current = entries.find((entry) => entry.rel === "current");
	assert(current, "exactly one entry is current");
	return current.href;
}

function invoke(harness: TestAppHarness, params: { token: string; action: Action; authored?: Record<string, string> }) {
	assert.equal(params.action.method, "POST");
	const serverValued = (params.action.fields ?? []).filter((field) => field.value !== undefined);
	const body = { ...Object.fromEntries(serverValued.map((field) => [field.name, field.value])), ...params.authored };
	const submission = request(harness.server)
		.post(params.action.href)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`)
		.redirects(0);
	if (Object.keys(body).length === 0) return submission;
	return params.action.type === "application/json"
		? submission.type("json").send(body)
		: submission.type("form").send(body);
}

const useApp = useTestServer();

describe("Process a readlist via a self-registered OAuth client", () => {
	it("creates a readlist, fills it, and drains every tab by removal while All keeps every article", async () => {
		const summary = createFakeSummaryProvider();
		const harness = useApp({ ...createDefaultTestAppFixture(TEST_APP_ORIGIN), summary });
		const token = await obtainAccessToken(harness, await registerClient(harness));

		const entry = await sirenGet(harness, { token, path: "/" });
		assert.equal(entry.status, 303);
		const all = await followRedirects(harness, { token, response: entry });

		const created = await invoke(harness, {
			token,
			action: actionNamed(all.body, "create-readlist"),
			authored: { label: READLIST_LABEL },
		});
		assert.equal(created.status, 303);
		const readlist = await followRedirects(harness, { token, response: created });
		assert.deepEqual(
			readlist.body.properties.readlists
				.filter((candidate: { rel: string }) => candidate.rel === "current")
				.map((candidate: { label: string }) => candidate.label),
			[READLIST_LABEL],
		);

		const save = async (url: string): Promise<string> => {
			const saved = await invoke(harness, {
				token,
				action: actionNamed(readlist.body, "save-article"),
				authored: { url },
			});
			assert.equal(saved.status, 201);
			return saved.body.properties.id;
		};
		const summarisedId = await save(SUMMARISED_URL);
		const readId = await save(READ_URL);
		const plainId = await save(PLAIN_URL);
		await harness.articleStore.writeContent({ url: SUMMARISED_URL, content: "<p>Automator body.</p>" });
		await harness.articleCrawl.markCrawlReady({ url: SUMMARISED_URL });
		summary.markSummaryReady({ url: SUMMARISED_URL, summary: SUMMARY, excerpt: "Automator excerpt." });

		const filled = await readCollection(harness, { token, path: linkHref(readlist.body, "self") });
		const toMarkRead = filled.body.entities.find((article: ArticleEntity) => article.properties.id === readId);
		assert(toMarkRead, "the readlist lists every article saved into it");
		const statusChange = await invoke(harness, { token, action: actionNamed(toMarkRead, "update-status") });
		assert.equal(statusChange.status, 303);
		assert.equal((await followRedirects(harness, { token, response: statusChange })).status, 200);

		const summaryById = new Map([[summarisedId, SUMMARY]]);
		const drainedByTab = new Map<string, string[]>();
		for (const tab of readlist.body.properties.tabs) {
			const drained: string[] = [];
			let listing = await readCollection(harness, { token, path: tab.href });
			while (listing.body.entities.length > 0) {
				const listed: string[] = listing.body.entities.map((entity: ArticleEntity) => entity.properties.id);
				const article: ArticleEntity = listing.body.entities[0];
				const { id } = article.properties;
				const markdown = await request(harness.server)
					.get(linkHref(article, "read"))
					.set("Accept", "text/markdown")
					.set("Authorization", `Bearer ${token}`);
				assert.equal(markdown.status, 200);
				const frontmatter = matter(markdown.text).data;
				assert.deepEqual(
					{
						id: frontmatter.readplace_id,
						title: frontmatter.title,
						source: frontmatter.source,
						summary: frontmatter.readplace_summary,
					},
					{ id, title: article.properties.title, source: article.properties.url, summary: summaryById.get(id) },
				);
				const removal = await invoke(harness, { token, action: actionNamed(article, "remove-from-readlist") });
				assert.equal(removal.status, 303);
				drained.push(id);
				listing = await followRedirects(harness, { token, response: removal });
				assert.equal(listing.status, 200);
				assert.equal(currentHref(listing.body.properties.tabs), tab.href);
				assert.deepEqual(
					listing.body.entities.map((entity: ArticleEntity) => entity.properties.id),
					listed.slice(1),
					"a removal answers with the same page, less the removed article",
				);
			}
			drainedByTab.set(tab.label, drained.sort());
		}
		assert.deepEqual(Object.fromEntries(drainedByTab), {
			"To Read": [summarisedId, plainId].sort(),
			Read: [readId],
		});

		for (const tab of readlist.body.properties.tabs) {
			assert.deepEqual((await readCollection(harness, { token, path: tab.href })).body.entities, []);
		}
		const allAgain = await readCollection(harness, { token, path: "/" });
		const listedInAll: string[] = [];
		for (const tab of allAgain.body.properties.tabs) {
			const listing = await readCollection(harness, { token, path: tab.href });
			listedInAll.push(...listing.body.entities.map((article: ArticleEntity) => article.properties.id));
		}
		assert.deepEqual(listedInAll.sort(), [summarisedId, readId, plainId].sort());
	});
});
