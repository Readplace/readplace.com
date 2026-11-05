import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ReaderArticleHashId } from "@packages/domain/article";
import { createDefaultTestAppFixture, TEST_APP_ORIGIN } from "@packages/test-fixtures";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";

const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const NOTICE = "This book is protected by DRM, so Readplace can't open it.";

const useApp = useTestServer();

async function signInAsOwnerOfFailedUpload() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const harness = useApp(fixture);
	const owner = await harness.auth.createUser({ email: "owner@example.com", password: "password123" });
	assert(owner.ok, "owner should be created");
	await fixture.articleStore.savePrivateItem({
		url: PRIVATE_URL,
		ownerUserId: owner.userId,
		media: { kind: "book", fileName: "dune.epub" },
		savedAt: new Date("2026-11-05T00:00:00.000Z"),
	});
	await fixture.articleStore.recordPrivateItemFailure({ url: PRIVATE_URL, notice: NOTICE });
	const agent = request.agent(harness.server);
	await agent
		.post("/login")
		.set(BROWSER_REQUEST_HEADERS)
		.type("form")
		.send({ email: "owner@example.com", password: "password123" });
	return agent;
}

describe("a media upload that failed processing", () => {
	it("shows its notice on the readlist card with a tracked link to upload again", async () => {
		const agent = await signInAsOwnerOfFailedUpload();

		const response = await agent.get("/queue").set(BROWSER_REQUEST_HEADERS);

		const doc = new JSDOM(response.text).window.document;
		const notice = doc.querySelector("[data-test-card-processing-notice]");
		expect(notice?.textContent).toContain(NOTICE);
		const href = doc.querySelector("[data-test-card-upload-again]")?.getAttribute("href");
		assert(href, "the failed card links to upload again");
		const link = new URL(href, TEST_APP_ORIGIN);
		expect(link.pathname).toBe("/upload");
		expect(Object.fromEntries(link.searchParams)).toEqual({
			utm_source: "queue-card",
			utm_medium: "internal",
			utm_content: "failed-card",
		});
	});

	it("shows its notice in the reader with an Upload again primary link", async () => {
		const agent = await signInAsOwnerOfFailedUpload();
		const id = ReaderArticleHashId.from(PRIVATE_URL).value;

		const response = await agent.get(`/queue/${id}/reader?poll=1`).set(BROWSER_REQUEST_HEADERS);

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-reader-slot]")?.getAttribute("data-reader-status")).toBe("processing-failed");
		expect(doc.querySelector(".article-body__reader-notice-text")?.textContent?.trim()).toBe(NOTICE);
		const primary = doc.querySelector("[data-test-reader-failed-primary]");
		expect(primary?.textContent?.trim()).toBe("Upload again");
		expect(primary?.getAttribute("href")).toMatch(/^\/upload\?/);
	});
});
