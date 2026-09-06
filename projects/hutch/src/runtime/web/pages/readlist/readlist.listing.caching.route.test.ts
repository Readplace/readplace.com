import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

function varyFields(header: string | undefined): string[] {
	assert(header, "the browser listing must carry a Vary header");
	return header.split(",").map((field) => field.trim().toLowerCase());
}

function styleNonce(html: string): string {
	const style = new JSDOM(html).window.document.querySelector("style[nonce]");
	assert(style, "the listing must render a nonce'd <style> for the ETag to prove it is nonce-neutral");
	const nonce = style.getAttribute("nonce");
	assert(nonce, "the <style> must carry a nonce");
	return nonce;
}

function setCookies(headers: { [key: string]: string | string[] | undefined }): string[] {
	const raw = headers["set-cookie"];
	return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

function pinnedFixture() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	return {
		...fixture,
		shared: { ...fixture.shared, now: () => new Date("2026-04-25T12:00:00.000Z") },
	};
}

describe("Browser listing caching (GET /queue)", () => {
	it("shares one nonce-neutral ETag across two renders whose CSP nonces differ", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/cache-a" });

		const first = await agent.get("/queue");
		const second = await agent.get("/queue");

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(styleNonce(first.text)).not.toBe(styleNonce(second.text));
		expect(first.headers.etag).toBe(second.headers.etag);
		expect(first.headers["cache-control"]).toBe("private, max-age=5");
		expect(varyFields(first.headers.vary)).toEqual(["accept", "origin", "cookie"]);
	});

	it("answers a revalidation of an unchanged listing with 304, no body, and the same validators", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: "https://example.com/cache-b" });

		const fresh = await agent.get("/queue");
		const etag = fresh.headers.etag;
		assert(etag, "the listing must carry an ETag");

		const revalidated = await agent.get("/queue").set("If-None-Match", etag);

		expect(revalidated.status).toBe(304);
		expect(revalidated.text).toBe("");
		expect(revalidated.headers.etag).toBe(etag);
		expect(revalidated.headers["cache-control"]).toBe("private, max-age=5");
		expect(varyFields(revalidated.headers.vary)).toEqual(["accept", "origin", "cookie"]);
	});

	it("bumps the generation cookie on a save and re-ships the listing with the new card", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);

		const stale = (await agent.get("/queue")).headers.etag;
		assert(stale, "the first listing must carry an ETag");

		const saved = await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/cache-new" });
		expect(saved.status).toBe(303);
		expect(setCookies(saved.headers).some((cookie) => cookie.startsWith("hutch_gen="))).toBe(true);

		const after = await agent.get("/queue").set("If-None-Match", stale);
		expect(after.status).toBe(200);
		const articles = new JSDOM(after.text).window.document.querySelectorAll(
			"[data-test-article-list] [data-test-article]",
		);
		expect(articles).toHaveLength(1);
	});

	it("keys a second queue's listing under its own ETag while carrying the same cache headers", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		const created = await agent.post("/queue/queues");
		const slug = new URL(created.headers.location, TEST_APP_ORIGIN).searchParams.get("queue");
		assert(slug, "creating a queue must land the reader on it");

		const defaultListing = await agent.get("/queue");
		const otherListing = await agent.get(`/queue?queue=${slug}`);

		expect(otherListing.status).toBe(200);
		expect(otherListing.headers["cache-control"]).toBe("private, max-age=5");
		expect(varyFields(otherListing.headers.vary)).toEqual(["accept", "origin", "cookie"]);
		expect(otherListing.headers.etag?.startsWith('W/"')).toBe(true);
		expect(otherListing.headers.etag).not.toBe(defaultListing.headers.etag);
	});

	it("serves the markdown representation without cache headers", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/markdown");
		expect(response.headers["cache-control"]).toBeUndefined();
	});

	it("stamps no generation cookie on a read, so a repeat read still hits the cache", async () => {
		const harness = useApp(pinnedFixture());
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.get("/queue");

		const response = await agent.get("/queue");

		expect(setCookies(response.headers).some((cookie) => cookie.startsWith("hutch_gen="))).toBe(false);
	});
});
