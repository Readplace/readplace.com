import assert from "node:assert/strict";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../test-app";
import { createAccessToken } from "../test-helpers/oauth-token";
import { SIREN_MEDIA_TYPE } from "./siren";
import { EXTENSION_READLIST_PAGE_SIZE } from "../pages/readlist/readlist-page-size";

const useApp = useTestServer();

type Harness = ReturnType<typeof useApp>;

interface Action {
	name: string;
	href: string;
	method?: string;
	fields?: { name: string; value?: string }[];
}

interface Entity {
	properties: { url: string; status: string };
	actions?: Action[];
}

function actionNamed(body: { actions?: Action[] }, name: string): Action {
	const action = body.actions?.find((candidate) => candidate.name === name);
	assert(action, `expected a ${name} action`);
	return action;
}

function sirenGet(harness: Harness, params: { path: string; token: string }) {
	return request(harness.server)
		.get(params.path)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`)
		.redirects(0);
}

async function save(harness: Harness, params: { token: string; url: string }): Promise<void> {
	const root = await sirenGet(harness, { path: "/", token: params.token });
	const saved = await request(harness.server)
		.post(actionNamed(root.body, "save-article").href)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`)
		.type("json")
		.send({ url: params.url });
	assert.equal(saved.status, 201, `saving ${params.url} must answer 201`);
}

async function saveThroughRoot(harness: Harness, params: { token: string; url: string }): Promise<request.Response> {
	const root = await sirenGet(harness, { path: "/", token: params.token });
	return request(harness.server)
		.post(actionNamed(root.body, "save-article").href)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`)
		.type("json")
		.send({ url: params.url });
}

function relsOf(body: { links: { rel: string[] }[] }): string[] {
	return body.links.flatMap((link) => link.rel);
}

function varyNamesOf(response: request.Response): string[] {
	return String(response.headers.vary)
		.split(",")
		.map((name) => name.trim().toLowerCase());
}

const COLLECTION_VARY_NAMES = ["accept", "authorization", "user-agent", "x-readplace-client", "x-readplace-save-continuity"];

async function markRead(harness: Harness, params: { token: string; url: string }): Promise<void> {
	const root = await sirenGet(harness, { path: "/", token: params.token });
	const entity = root.body.entities.find((candidate: Entity) => candidate.properties.url === params.url);
	assert(entity, `${params.url} must be listed unread`);
	const action = actionNamed(entity, "update-status");
	const response = await request(harness.server)
		.post(action.href)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`)
		.type("form")
		.send(Object.fromEntries((action.fields ?? []).map((field) => [field.name, field.value])))
		.redirects(0);
	assert.equal(response.status, 303, `marking ${params.url} read must answer 303`);
}

function urlsOf(body: { entities: Entity[] }): string[] {
	return body.entities.map((entity) => entity.properties.url);
}

async function readTabOf(harness: Harness, token: string): Promise<request.Response> {
	const root = await sirenGet(harness, { path: "/", token });
	const tab = root.body.properties.tabs.find((entry: { label: string }) => entry.label === "Read");
	assert(tab, "the collection must advertise a Read tab");
	return sirenGet(harness, { path: tab.href, token });
}

describe("the public API's documented contract", () => {
	it("answers the entry point with the collection itself, revalidated before reuse", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);

		const response = await sirenGet(harness, { path: "/", token });

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		expect(response.body.actions.map((action: Action) => action.name)).toContain("search");
	});

	it("lists unread articles newest saved first when search sends no status and no order", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		await save(harness, { token, url: "https://example.com/older" });
		await save(harness, { token, url: "https://example.com/newer" });
		await save(harness, { token, url: "https://example.com/read" });
		await markRead(harness, { token, url: "https://example.com/read" });

		const root = await sirenGet(harness, { path: "/", token });
		const searched = await sirenGet(harness, { path: actionNamed(root.body, "search").href, token });

		expect(urlsOf(searched.body)).toEqual(["https://example.com/newer", "https://example.com/older"]);
	});

	it("sorts the Read tab by when each article was read, not when it was saved", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		await save(harness, { token, url: "https://example.com/saved-first" });
		await save(harness, { token, url: "https://example.com/saved-second" });
		await markRead(harness, { token, url: "https://example.com/saved-second" });
		await new Promise((resolve) => setTimeout(resolve, 5));
		await markRead(harness, { token, url: "https://example.com/saved-first" });

		const read = await readTabOf(harness, token);

		expect(urlsOf(read.body)).toEqual(["https://example.com/saved-first", "https://example.com/saved-second"]);
	});
	it("answers a save still being resolved behind a wrapper link with 409, an error-class entity and one warning message", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);

		const queued = await saveThroughRoot(harness, { token, url: "https://archive.ph/abc" });

		expect(queued.status).toBe(409);
		expect(queued.body.class).toEqual(["error"]);
		expect(queued.body.properties.messages.map((message: { type: string }) => message.type)).toEqual(["warning"]);
	});

	it("varies the collection answer and the 303 to its current address on the same request headers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);

		const collection = await sirenGet(harness, { path: "/queue", token });
		const redirect = await sirenGet(harness, { path: "/queue?queue=default", token });

		expect(collection.status).toBe(200);
		expect(redirect.status).toBe(303);
		expect(varyNamesOf(collection)).toEqual(expect.arrayContaining(COLLECTION_VARY_NAMES));
		expect(varyNamesOf(redirect)).toEqual(expect.arrayContaining(COLLECTION_VARY_NAMES));
		expect(redirect.headers["cache-control"]).toBe("private, no-cache");
	});

	it("counts only the matching article in total, pages and next under the url filter", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		for (let index = 0; index <= 20; index++) {
			await save(harness, { token, url: `https://example.com/filtered-${index}` });
		}

		const unfiltered = await sirenGet(harness, { path: "/queue", token });
		const filtered = await sirenGet(harness, { path: `/queue?url=${encodeURIComponent("https://example.com/filtered-20")}`, token });

		expect(relsOf(unfiltered.body)).toContain("next");
		expect(urlsOf(filtered.body)).toEqual(["https://example.com/filtered-20"]);
		expect(filtered.body.properties.total).toEqual({ label: "1 Saved Article" });
		expect(filtered.body.properties.pages.map((entry: { label: string }) => entry.label)).toEqual(["1"]);
		expect(relsOf(filtered.body)).not.toContain("next");
	});

	it("marks only the next link that leads past the pages an offline download resolves with the offline-prefetch class", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		for (let index = 0; index <= 2 * EXTENSION_READLIST_PAGE_SIZE; index++) {
			await save(harness, { token, url: `https://example.com/offline-${index}` });
		}
		const nextOf = (body: { links: { rel: string[]; href: string; class?: string[] }[] }) => {
			const next = body.links.find((link) => link.rel.includes("next"));
			assert(next, "the collection page must advertise a next link");
			return next;
		};

		const pageOne = await sirenGet(harness, { path: "/queue", token });
		const pageTwo = await sirenGet(harness, { path: nextOf(pageOne.body).href, token });

		expect(pageOne.body.properties.pages.map((entry: { label: string }) => entry.label)).toEqual(["1", "2", "3"]);
		expect(nextOf(pageOne.body)).not.toHaveProperty("class");
		expect(nextOf(pageTwo.body).class).toEqual(["offline-prefetch"]);
	});

	it("answers a page past the last with 200, no articles, a prev link and no next link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		await save(harness, { token, url: "https://example.com/only" });

		const response = await sirenGet(harness, { path: "/queue?page=3", token });

		expect(response.status).toBe(200);
		expect(response.body.entities).toEqual([]);
		expect(relsOf(response.body)).toContain("prev");
		expect(relsOf(response.body)).not.toContain("next");
	});

	it("refuses to complete an upload finished more than 30 minutes earlier with 422 upload-not-found", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const finishedAt = new Date(fixture.shared.now().getTime() - 31 * 60 * 1000);
		const harness = useApp({
			...fixture,
			pendingUpload: {
				...fixture.pendingUpload,
				statPendingUpload: async () => ({ byteLength: 100, lastModified: finishedAt }),
			},
		});
		const token = await createAccessToken(harness);

		const response = await request(harness.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.field("url", "https://example.com/late-upload.html")
			.field("mediaType", "text/html")
			.field("saveAttemptId", "8a1f3c52-6d1e-4c7b-9b0a-2f4e5d6c7b8a")
			.field("uploaded", "true");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("upload-not-found");
		expect(response.body.properties.message).toBe("The uploaded content has expired; please re-upload");
	});

	it("answers report-age-range with 204 for a reader the store reports as 13 or over", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await createAccessToken(harness);
		const root = await sirenGet(harness, { path: "/", token });

		const response = await request(harness.server)
			.post(actionNamed(root.body, "report-age-range").href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.type("form")
			.send({ ageRange: "18-plus", parentalApproval: "none-reported" });

		expect(response.status).toBe(204);
	});
});
