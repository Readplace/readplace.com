import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

function summaryText(doc: Document): string {
	return doc.querySelector("[data-test-import-summary]")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function findCookie(headers: { [key: string]: string | string[] | undefined }, prefix: string): string | undefined {
	const raw = headers["set-cookie"];
	const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
	return cookies.find((c) => c.startsWith(prefix));
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

const useApp = useTestServer();

describe("Import routes", () => {
	describe("GET /import (unauthenticated)", () => {
		it("redirects to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/import?feature=import");
			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});
	});

	describe("GET /import (authenticated)", () => {
		it("renders the upload form when the feature flag is on", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?feature=import");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector('[data-test-form="import-file"]');
			assert(form, "upload form must be rendered");
			expect(form.getAttribute("action")).toBe("/import?feature=import");
			const button = form.querySelector('[data-test-action="import-upload"]');
			assert(button, "Upload button must remain in the DOM as the no-JS fallback");
			expect(button.textContent).toBe("Upload");
		});

		it("redirects to /queue when the feature flag is missing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("renders the import_no_urls message when error_code=import_no_urls", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?feature=import&error_code=import_no_urls");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const error = doc.querySelector("[data-test-import-error]");
			assert(error, "error banner must be rendered when an error code is present");
			expect(error.textContent).toBe("We couldn't find any links in that file.");
		});

		it("renders the import_too_large message when error_code=import_too_large", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?feature=import&error_code=import_too_large");

			const doc = new JSDOM(response.text).window.document;
			const error = doc.querySelector("[data-test-import-error]");
			assert(error, "error banner must be rendered");
			expect(error.textContent).toContain("fayner@readplace.com");
		});

		it("renders the import_session_not_found message when error_code=import_session_not_found", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?feature=import&error_code=import_session_not_found");

			const doc = new JSDOM(response.text).window.document;
			const error = doc.querySelector("[data-test-import-error]");
			assert(error, "error banner must be rendered");
			expect(error.textContent).toBe("That import session has expired. Please upload the file again.");
		});

		it("does not render the error banner when no error_code is present", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?feature=import");

			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-import-error]")).toBeNull();
		});
	});

	describe("POST /import (unauthenticated)", () => {
		it("redirects to /login", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).post("/import");
			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login");
		});
	});

	describe("POST /import", () => {
		it("creates a session and redirects to the review page when URLs are found", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const { body, contentType } = multipartBody("empty.txt", Buffer.from("just some prose"));

			const response = await agent
				.post("/import")
				.set("Content-Type", contentType)
				.send(body);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/import?feature=import&error_code=import_no_urls");
		});

		it("redirects with import_too_large when the upload exceeds the size cap", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			expect(response.headers.location).toBe("/import?feature=import&error_code=import_too_large");
		});

		it("redirects with import_no_urls for non-multipart bodies", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import")
				.set("Content-Type", "text/plain")
				.send("https://example.com/x");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/import?feature=import&error_code=import_no_urls");
		});
	});

	describe("GET /import/:id", () => {
		it("renders the review screen with all URLs checked by default", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			expect(summaryText(doc)).toContain("3 of 3 selected");
		});

		it("redirects to /queue for an invalid session id", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import/not-a-session-id");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue");
		});

		it("redirects with import_session_not_found when the session is owned by another user", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const { auth } = harness;
			await auth.createUser({ email: "owner@example.com", password: "password123" });
			const owner = request.agent(harness.server);
			await owner.post("/login").type("form").send({ email: "owner@example.com", password: "password123" });
			const { body, contentType } = multipartBody("urls.txt", Buffer.from("https://example.com/owned"));
			const create = await owner.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			await auth.createUser({ email: "intruder@example.com", password: "password123" });
			const intruder = request.agent(harness.server);
			await intruder.post("/login").type("form").send({ email: "intruder@example.com", password: "password123" });

			const response = await intruder.get(sessionPath);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/import?feature=import&error_code=import_session_not_found");
		});

		it("paginates results across pages", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			expect(summaryText(doc)).toContain("1 of 2 selected");
		});

		it("returns 422 for malformed body", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const { body, contentType } = multipartBody("urls.txt", Buffer.from("https://example.com/a"));
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);

			const response = await agent
				.post(`${create.headers.location}/toggle`)
				.type("form")
				.send({ index: "not-a-number" });

			expect(response.status).toBe(422);
		});

		it("returns 422 for an invalid session id format", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/not-an-id/toggle")
				.type("form")
				.send({ index: 0, checked: "false" });

			expect(response.status).toBe(422);
		});
	});

	describe("GET /import/:id master checkbox", () => {
		it("renders the master checkbox checked when every row is selected", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			expect(summaryText(doc)).toContain("0 of 3 selected");
		});

		it("re-selects every row from a partially-deselected state", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			expect(summaryText(doc)).toContain("2 of 2 selected");
		});

		it("deselects rows on pages the user is not currently viewing", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
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
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const { body, contentType } = multipartBody("urls.txt", Buffer.from("https://example.com/a"));
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);

			const response = await agent
				.post(`${create.headers.location}/toggle-all`)
				.type("form")
				.send({ checked: "maybe" });

			expect(response.status).toBe(422);
		});

		it("returns 422 for an invalid session id format", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import/not-an-id/toggle-all")
				.type("form")
				.send({ checked: "false" });

			expect(response.status).toBe(422);
		});
	});

	describe("POST /import/:id/commit", () => {
		it("imports selected URLs into the user's queue and deletes the session", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, articleStore } = harness;
			const agent = await loginAgent(harness.server, harness.auth);
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
			expect(commit.headers.location).toBe("/queue?import_imported=2&import_total=3&import_skipped=0");

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "user must exist");
			const result = await articleStore.findArticlesByUser({ userId });
			const urls = result.articles.map((a) => a.url).sort();
			expect(urls).toEqual(["https://example.com/a", "https://example.com/c"]);

			const reuse = await agent.get(sessionPath);
			expect(reuse.status).toBe(303);
			expect(reuse.headers.location).toBe("/import?feature=import&error_code=import_session_not_found");
		});

		it("redirects when the session id is malformed", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/import/not-an-id/commit");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/import?feature=import&error_code=import_session_not_found");
		});

		it("redirects when the session no longer exists", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/import/00000000000000000000000000000000/commit");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/import?feature=import&error_code=import_session_not_found");
		});

		it("skips non-saveable URLs, imports the rest, and reports skipped count in the redirect", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, articleStore } = harness;
			const agent = await loginAgent(harness.server, harness.auth);
			const file = Buffer.from(
				"https://example.com/a http://localhost:3000/queue http://router.home.arpa/ https://example.com/b",
			);
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			const commit = await agent.post(`${sessionPath}/commit`);

			expect(commit.status).toBe(303);
			expect(commit.headers.location).toBe(
				"/queue?import_imported=2&import_total=4&import_skipped=2",
			);
			const skippedCookie = findCookie(commit.headers, "import_skipped=");
			assert(skippedCookie, "import_skipped cookie must be set when skips exist");

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId);
			const stored = await articleStore.findArticlesByUser({ userId });
			const urls = stored.articles.map((a) => a.url).sort();
			expect(urls).toEqual(["https://example.com/a", "https://example.com/b"]);
		});

		it("does not set the import_skipped cookie when every URL is saveable", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const file = Buffer.from("https://example.com/a https://example.com/b");
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			const commit = await agent.post(`${sessionPath}/commit`);

			expect(commit.status).toBe(303);
			expect(commit.headers.location).toBe(
				"/queue?import_imported=2&import_total=2&import_skipped=0",
			);
			const skippedCookie = findCookie(commit.headers, "import_skipped=");
			expect(skippedCookie).toBeUndefined();
		});

		it("renders the skipped URLs on /queue after commit and clears the cookie on first view", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const file = Buffer.from(
				"https://example.com/a http://localhost/secret http://router.home.arpa/",
			);
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			await agent.post(`${sessionPath}/commit`);

			const queueResponse = await agent.get(
				"/queue?import_imported=1&import_total=3&import_skipped=2",
			);
			const doc = new JSDOM(queueResponse.text).window.document;
			const skipped = doc.querySelectorAll("[data-test-import-skipped-row]");
			expect(skipped.length).toBe(2);
			const urls = Array.from(skipped).map(
				(row) => row.querySelector("[data-test-import-skipped-url]")?.textContent,
			);
			expect(urls).toContain("http://localhost/secret");
			expect(urls).toContain("http://router.home.arpa/");

			const clearCookie = findCookie(queueResponse.headers, "import_skipped=");
			assert(clearCookie, "queue must clear the import_skipped cookie");
			expect(clearCookie).toMatch(/Expires=Thu, 01 Jan 1970/);

			const again = await agent.get("/queue");
			const docAgain = new JSDOM(again.text).window.document;
			expect(docAgain.querySelectorAll("[data-test-import-skipped-row]").length).toBe(0);
		});
	});
});
