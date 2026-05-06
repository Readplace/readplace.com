import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { createTestApp, type TestAppResult } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

async function loginAgent(app: TestAppResult["app"], auth: TestAppResult["auth"]) {
	await auth.createUser({ email: "test@example.com", password: "password123" });
	const agent = request.agent(app);
	await agent
		.post("/login")
		.type("form")
		.send({ email: "test@example.com", password: "password123" });
	return agent;
}

function multipartBody(filename: string, content: Buffer): { body: Buffer; contentType: string } {
	const boundary = "----TestBoundary123456";
	const head = Buffer.from(
		`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
	return {
		body: Buffer.concat([head, content, tail]),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

describe("Import routes", () => {
	describe("POST /import (unauthenticated)", () => {
		it("redirects to /login", async () => {
			const { app } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(app).post("/import");
			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});
	});

	describe("POST /import", () => {
		it("creates a session and redirects to the review page when URLs are found", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const file = Buffer.from(
				"<a href=\"https://example.com/post-1\">x</a> https://example.com/post-2",
			);
			const { body, contentType } = multipartBody("pocket.html", file);

			const response = await agent
				.post("/import")
				.set("Content-Type", contentType)
				.send(body);

			expect(response.status).toBe(303);
			assert(response.headers.location.startsWith("/import/"), "expected redirect to /import/:id");
		});

		it("redirects with import_no_urls when no URLs are found", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const { body, contentType } = multipartBody("empty.txt", Buffer.from("just some prose"));

			const response = await agent
				.post("/import")
				.set("Content-Type", contentType)
				.send(body);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?error_code=import_no_urls");
		});

		it("redirects with import_too_large when the upload exceeds the size cap", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			// 6 MiB body — overshoots the 5 MiB cap so express.raw aborts with
			// `entity.too.large`, which the size-limit error handler maps to the
			// import_too_large flash.
			const oversize = Buffer.alloc(6 * 1024 * 1024, 0x41);
			const { body, contentType } = multipartBody("big.bin", oversize);

			const response = await agent
				.post("/import")
				.set("Content-Type", contentType)
				.send(body);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?error_code=import_too_large");
		});

		it("redirects with import_no_urls for non-multipart bodies", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);

			const response = await agent
				.post("/import")
				.set("Content-Type", "text/plain")
				.send("https://example.com/x");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?error_code=import_no_urls");
		});
	});

	describe("GET /import/:id", () => {
		it("renders the review screen with all URLs checked by default", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const file = Buffer.from(
				"https://example.com/post-1 https://example.com/post-2 https://example.com/post-3",
			);
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent
				.post("/import")
				.set("Content-Type", contentType)
				.send(body);
			const sessionPath = create.headers.location;

			const response = await agent.get(sessionPath);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const checkboxes = doc.querySelectorAll<HTMLInputElement>("[data-test-import-checkbox]");
			expect(checkboxes).toHaveLength(3);
			for (const cb of checkboxes) {
				expect(cb.hasAttribute("checked")).toBe(true);
			}
			expect(doc.querySelector("[data-test-import-summary]")?.textContent).toContain("3 of 3 selected");
		});

		it("redirects to /queue for an invalid session id", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);

			const response = await agent.get("/import/not-a-session-id");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("redirects with import_session_not_found when the session is owned by another user", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const { app, auth } = createTestApp(fixture);
			await auth.createUser({ email: "owner@example.com", password: "password123" });
			const owner = request.agent(app);
			await owner.post("/login").type("form").send({ email: "owner@example.com", password: "password123" });
			const { body, contentType } = multipartBody("urls.txt", Buffer.from("https://example.com/owned"));
			const create = await owner.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			await auth.createUser({ email: "intruder@example.com", password: "password123" });
			const intruder = request.agent(app);
			await intruder.post("/login").type("form").send({ email: "intruder@example.com", password: "password123" });

			const response = await intruder.get(sessionPath);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?error_code=import_session_not_found");
		});

		it("paginates results across pages", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const urls = Array.from({ length: 60 }, (_v, i) => `https://example.com/post-${i}`);
			const { body, contentType } = multipartBody("many.txt", Buffer.from(urls.join("\n")));
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);

			const page1 = await agent.get(create.headers.location);
			const page2 = await agent.get(`${create.headers.location}?page=2`);

			const doc1 = new JSDOM(page1.text).window.document;
			const doc2 = new JSDOM(page2.text).window.document;
			expect(doc1.querySelectorAll("[data-test-import-row]")).toHaveLength(50);
			expect(doc2.querySelectorAll("[data-test-import-row]")).toHaveLength(10);
		});
	});

	describe("POST /import/:id/toggle", () => {
		it("deselects a row and updates the selection summary", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const file = Buffer.from("https://example.com/a https://example.com/b");
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			const toggleResp = await agent
				.post(`${sessionPath}/toggle`)
				.type("form")
				.send({ index: 0, checked: "false" });
			expect(toggleResp.status).toBe(303);

			const review = await agent.get(sessionPath);
			const doc = new JSDOM(review.text).window.document;
			const first = doc.querySelector<HTMLInputElement>('[data-test-import-checkbox="0"]');
			const second = doc.querySelector<HTMLInputElement>('[data-test-import-checkbox="1"]');
			assert(first, "first checkbox must exist");
			assert(second, "second checkbox must exist");
			expect(first.hasAttribute("checked")).toBe(false);
			expect(second.hasAttribute("checked")).toBe(true);
			expect(doc.querySelector("[data-test-import-summary]")?.textContent).toContain("1 of 2 selected");
		});

		it("returns 422 for malformed body", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const { body, contentType } = multipartBody("urls.txt", Buffer.from("https://example.com/a"));
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);

			const response = await agent
				.post(`${create.headers.location}/toggle`)
				.type("form")
				.send({ index: "not-a-number" });

			expect(response.status).toBe(422);
		});

		it("returns 422 for an invalid session id format", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);

			const response = await agent
				.post("/import/not-an-id/toggle")
				.type("form")
				.send({ index: 0, checked: "false" });

			expect(response.status).toBe(422);
		});
	});

	describe("GET /import/:id master checkbox", () => {
		it("renders the master checkbox checked when every row is selected", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const file = Buffer.from("https://example.com/a https://example.com/b");
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);

			const response = await agent.get(create.headers.location);

			const doc = new JSDOM(response.text).window.document;
			const master = doc.querySelector<HTMLInputElement>("[data-test-import-select-all]");
			assert(master, "master checkbox must exist");
			expect(master.hasAttribute("checked")).toBe(true);
			expect(master.hasAttribute("data-import-indeterminate")).toBe(false);
		});

		it("renders the master checkbox unchecked-with-indeterminate when partially selected", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const file = Buffer.from("https://example.com/a https://example.com/b");
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;
			await agent
				.post(`${sessionPath}/toggle`)
				.type("form")
				.send({ index: 0, checked: "false" });

			const response = await agent.get(sessionPath);

			const doc = new JSDOM(response.text).window.document;
			const master = doc.querySelector<HTMLInputElement>("[data-test-import-select-all]");
			assert(master, "master checkbox must exist");
			expect(master.hasAttribute("checked")).toBe(false);
			expect(master.hasAttribute("data-import-indeterminate")).toBe(true);
		});

		it("renders the master checkbox unchecked with no indeterminate marker when all are deselected", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const file = Buffer.from("https://example.com/a https://example.com/b");
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;
			await agent.post(`${sessionPath}/toggle-all`).type("form").send({ checked: "false" });

			const response = await agent.get(sessionPath);

			const doc = new JSDOM(response.text).window.document;
			const master = doc.querySelector<HTMLInputElement>("[data-test-import-select-all]");
			assert(master, "master checkbox must exist");
			expect(master.hasAttribute("checked")).toBe(false);
			expect(master.hasAttribute("data-import-indeterminate")).toBe(false);
		});
	});

	describe("POST /import/:id/toggle-all", () => {
		it("deselects every row and updates the summary to 0 of N", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const file = Buffer.from("https://example.com/a https://example.com/b https://example.com/c");
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			const toggleResp = await agent
				.post(`${sessionPath}/toggle-all`)
				.type("form")
				.send({ checked: "false" });
			expect(toggleResp.status).toBe(303);

			const review = await agent.get(sessionPath);
			const doc = new JSDOM(review.text).window.document;
			const checkboxes = doc.querySelectorAll<HTMLInputElement>("[data-test-import-checkbox]");
			expect(checkboxes).toHaveLength(3);
			for (const cb of checkboxes) {
				expect(cb.hasAttribute("checked")).toBe(false);
			}
			expect(doc.querySelector("[data-test-import-summary]")?.textContent).toContain("0 of 3 selected");
		});

		it("re-selects every row from a partially-deselected state", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const file = Buffer.from("https://example.com/a https://example.com/b");
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;
			await agent
				.post(`${sessionPath}/toggle`)
				.type("form")
				.send({ index: 0, checked: "false" });

			const toggleResp = await agent
				.post(`${sessionPath}/toggle-all`)
				.type("form")
				.send({ checked: "true" });
			expect(toggleResp.status).toBe(303);

			const review = await agent.get(sessionPath);
			const doc = new JSDOM(review.text).window.document;
			const checkboxes = doc.querySelectorAll<HTMLInputElement>("[data-test-import-checkbox]");
			for (const cb of checkboxes) {
				expect(cb.hasAttribute("checked")).toBe(true);
			}
			expect(doc.querySelector("[data-test-import-summary]")?.textContent).toContain("2 of 2 selected");
		});

		it("deselects rows on pages the user is not currently viewing", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const urls = Array.from({ length: 60 }, (_v, i) => `https://example.com/post-${i}`);
			const { body, contentType } = multipartBody("many.txt", Buffer.from(urls.join("\n")));
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			await agent.post(`${sessionPath}/toggle-all`).type("form").send({ checked: "false" });

			const page2 = await agent.get(`${sessionPath}?page=2`);
			const doc2 = new JSDOM(page2.text).window.document;
			const page2Checkboxes = doc2.querySelectorAll<HTMLInputElement>("[data-test-import-checkbox]");
			expect(page2Checkboxes).toHaveLength(10);
			for (const cb of page2Checkboxes) {
				expect(cb.hasAttribute("checked")).toBe(false);
			}
		});

		it("preserves the current page in the redirect", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const urls = Array.from({ length: 60 }, (_v, i) => `https://example.com/post-${i}`);
			const { body, contentType } = multipartBody("many.txt", Buffer.from(urls.join("\n")));
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			const toggleResp = await agent
				.post(`${sessionPath}/toggle-all?page=2`)
				.type("form")
				.send({ checked: "false" });

			expect(toggleResp.status).toBe(303);
			expect(toggleResp.headers.location).toBe(`${sessionPath}?page=2`);
		});

		it("returns 422 for malformed body", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const { body, contentType } = multipartBody("urls.txt", Buffer.from("https://example.com/a"));
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);

			const response = await agent
				.post(`${create.headers.location}/toggle-all`)
				.type("form")
				.send({ checked: "maybe" });

			expect(response.status).toBe(422);
		});

		it("returns 422 for an invalid session id format", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);

			const response = await agent
				.post("/import/not-an-id/toggle-all")
				.type("form")
				.send({ checked: "false" });

			expect(response.status).toBe(422);
		});
	});

	describe("POST /import/:id/commit", () => {
		it("imports selected URLs into the user's queue and deletes the session", async () => {
			const { app, auth, articleStore } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);
			const file = Buffer.from(
				"https://example.com/a https://example.com/b https://example.com/c",
			);
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;
			await agent
				.post(`${sessionPath}/toggle`)
				.type("form")
				.send({ index: 1, checked: "false" });

			const commit = await agent.post(`${sessionPath}/commit`);

			expect(commit.status).toBe(303);
			expect(commit.headers.location).toBe("/queue?import_imported=2&import_total=3");

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "user must exist");
			const result = await articleStore.findArticlesByUser({ userId });
			const urls = result.articles.map((a) => a.url).sort();
			expect(urls).toEqual(["https://example.com/a", "https://example.com/c"]);

			const reuse = await agent.get(sessionPath);
			expect(reuse.status).toBe(303);
			expect(reuse.headers.location).toBe("/queue?error_code=import_session_not_found");
		});

		it("redirects when the session id is malformed", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);

			const response = await agent.post("/import/not-an-id/commit");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?error_code=import_session_not_found");
		});

		it("redirects when the session no longer exists", async () => {
			const { app, auth } = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(app, auth);

			const response = await agent.post("/import/00000000000000000000000000000000/commit");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?error_code=import_session_not_found");
		});
	});
});
