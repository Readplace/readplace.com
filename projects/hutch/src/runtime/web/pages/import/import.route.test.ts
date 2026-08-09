import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { ImportSessionIdSchema } from "@packages/domain/import-session";
import { useTestServer, loginAgent } from "../../../test-app";
import type { ImportUploadedEvent, ImportCommittedEvent } from "@packages/web-analytics";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";

function sessionIdFromLocation(location: string): ReturnType<typeof ImportSessionIdSchema.parse> {
	return ImportSessionIdSchema.parse(location.replace("/import/", ""));
}

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
const ONE_DAY_MS = 86_400_000;

describe("Import routes", () => {
	describe("GET /import (unauthenticated)", () => {
		it("renders the acquire page with both tabs for a logged-out visitor", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/import");
			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const tabKeys = Array.from(doc.querySelectorAll("[data-test-import-tab]")).map(
				(el) => el.getAttribute("data-test-import-tab"),
			);
			expect(tabKeys).toEqual(["from-url", "upload"]);
		});

		it("renders the from-url form by default at /import", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/import");
			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const formIds = Array.from(doc.querySelectorAll("[data-test-form]")).map(
				(el) => el.getAttribute("data-test-form"),
			);
			expect(formIds).toEqual(["import-from-url"]);
			const fromUrlTab = doc.querySelector('[data-test-import-tab="from-url"]');
			assert(fromUrlTab, "from-url tab must render");
			expect(fromUrlTab.getAttribute("aria-current")).toBe("page");
		});

		it("renders the guest nav with an Import Links entry", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get("/import");
			const doc = new JSDOM(response.text).window.document;
			const nav = doc.querySelector("[data-test-nav-variant]");
			assert(nav, "nav must render");
			expect(nav.getAttribute("data-test-nav-variant")).toBe("guest");
			const navKeys = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map(
				(el) => el.getAttribute("data-test-nav-item"),
			);
			expect(navKeys).toContain("import");
		});
	});

	describe("GET /import (authenticated)", () => {
		it("renders the upload form with both import tabs", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=upload");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector('[data-test-form="import-file"]');
			assert(form, "upload form must be rendered");
			expect(form.getAttribute("action")).toBe("/import");
			const button = form.querySelector('[data-test-action="import-upload"]');
			assert(button, "Upload button must remain in the DOM as the no-JS fallback");
			expect(button.textContent).toBe("Upload");
			const tabKeys = Array.from(doc.querySelectorAll("[data-test-import-tab]")).map(
				(el) => el.getAttribute("data-test-import-tab"),
			);
			expect(tabKeys).toEqual(["from-url", "upload"]);
			const formIds = Array.from(doc.querySelectorAll("[data-test-form]")).map(
				(el) => el.getAttribute("data-test-form"),
			);
			expect(formIds).toEqual(["import-file"]);
		});

		it("renders the upload form in idle state with both idle and uploading regions", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=upload");

			const doc = new JSDOM(response.text).window.document;
			const form = doc.querySelector<HTMLFormElement>('[data-test-form="import-file"]');
			assert(form, "upload form must be rendered");
			expect(form.getAttribute("data-import-state")).toBe("idle");
			expect(form.getAttribute("hx-post")).toBe("/import");
			expect(form.getAttribute("hx-encoding")).toBe("multipart/form-data");
			const idle = form.querySelector('[data-import-region="idle"]');
			const uploading = form.querySelector('[data-import-region="uploading"]');
			assert(idle, "idle region must always be rendered");
			assert(uploading, "uploading region must always be rendered");
			const fill = uploading.querySelector('[data-import-progress-fill]');
			const label = uploading.querySelector('[data-import-progress-label]');
			assert(fill, "progress fill must be rendered inside the uploading region");
			assert(label, "progress label must be rendered inside the uploading region");
		});

		it("includes the import client bundle on the upload page", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=upload");

			const doc = new JSDOM(response.text).window.document;
			const script = doc.querySelector('script[src="/client-dist/import.client.js"]');
			assert(script, "import.client.js bundle must be loaded on the upload page");
		});

		it("renders the import_no_urls message when error_code=import_no_urls", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=upload&error_code=import_no_urls");

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const error = doc.querySelector("[data-test-import-error]");
			assert(error, "error banner must be rendered when an error code is present");
			expect(error.textContent).toBe("We couldn't find any links in that file.");
		});

		it("renders the import_too_large message when error_code=import_too_large", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=upload&error_code=import_too_large");

			const doc = new JSDOM(response.text).window.document;
			const error = doc.querySelector("[data-test-import-error]");
			assert(error, "error banner must be rendered");
			expect(error.textContent).toContain("readplace+migrate@readplace.com");
		});

		it("renders the import_session_not_found message when error_code=import_session_not_found", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import?mode=upload&error_code=import_session_not_found");

			const doc = new JSDOM(response.text).window.document;
			const error = doc.querySelector("[data-test-import-error]");
			assert(error, "error banner must be rendered");
			expect(error.textContent).toBe("That import session has expired. Please upload the file again.");
		});

		it("does not render the error banner when no error_code is present", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.get("/import");

			const doc = new JSDOM(response.text).window.document;
			expect(doc.querySelector("[data-test-import-error]")).toBeNull();
		});
	});

	describe("POST /import (unauthenticated)", () => {
		it("creates an anonymous session (no userId) and redirects to the review page", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const { body, contentType } = multipartBody(
				"urls.txt",
				Buffer.from("https://example.com/a https://example.com/b"),
			);

			const response = await request(harness.server)
				.post("/import")
				.set("Content-Type", contentType)
				.send(body);

			expect(response.status).toBe(303);
			assert(response.headers.location.startsWith("/import/"), "expected redirect to /import/:id");
			const session = await fixture.importSession.importSessionStore.findImportSession({
				id: sessionIdFromLocation(response.headers.location),
				userId: undefined,
			});
			assert(session, "anonymous session must exist");
			expect(session.userId).toBeUndefined();
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
			expect(response.headers.location).toBe("/import?mode=upload&error_code=import_no_urls");
		});

		it("redirects with import_too_large when the upload exceeds the size cap", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			// 6 MiB body — overshoots the upload cap so express.raw aborts with
			// `entity.too.large`, which the size-limit error handler maps to the
			// import_too_large flash.
			const oversize = Buffer.alloc(6 * 1024 * 1024, 0x41);
			const { body, contentType } = multipartBody("big.bin", oversize);

			const response = await agent
				.post("/import")
				.set("Content-Type", contentType)
				.send(body);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/import?mode=upload&error_code=import_too_large");
		});

		it("redirects with import_no_urls for non-multipart bodies", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent
				.post("/import")
				.set("Content-Type", "text/plain")
				.send("https://example.com/x");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/import?mode=upload&error_code=import_no_urls");
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
			expect(response.headers.location).toBe("/import?mode=upload&error_code=import_session_not_found");
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

		it("preserves the current page in the redirect when posting to the rendered row form action", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const urls = Array.from({ length: 60 }, (_v, i) => `https://example.com/post-${i}`);
			const { body, contentType } = multipartBody("many.txt", Buffer.from(urls.join("\n")));
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			const page2 = await agent.get(`${sessionPath}?page=2`);
			const doc2 = new JSDOM(page2.text).window.document;
			const row = doc2.querySelector<HTMLElement>("[data-test-import-row]");
			assert(row, "at least one row must be rendered on page 2");
			const form = row.querySelector<HTMLFormElement>("form");
			assert(form, "row toggle form must be rendered");
			const action = form.getAttribute("action");
			assert(action, "row form must have an action attribute");
			const indexInput = form.querySelector<HTMLInputElement>('input[name="index"]');
			assert(indexInput, "row form must have an index hidden input");

			const toggleResp = await agent
				.post(action)
				.type("form")
				.send({ index: indexInput.value, checked: "false" });

			expect(toggleResp.status).toBe(303);
			expect(toggleResp.headers.location).toBe(`${sessionPath}?page=2`);
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

		it("preserves the current page in the redirect when posting to the rendered toolbar form action", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const urls = Array.from({ length: 60 }, (_v, i) => `https://example.com/post-${i}`);
			const { body, contentType } = multipartBody("many.txt", Buffer.from(urls.join("\n")));
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			const page2 = await agent.get(`${sessionPath}?page=2`);
			const doc2 = new JSDOM(page2.text).window.document;
			const form = doc2.querySelector<HTMLFormElement>('[data-test-form="import-toggle-all"]');
			assert(form, "toggle-all form must be rendered on page 2");
			const action = form.getAttribute("action");
			assert(action, "toggle-all form must have an action attribute");

			const toggleResp = await agent.post(action).type("form").send({ checked: "false" });

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
		it("tags every committed URL as an import, so the reader can name where it came from", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, articleStore } = harness;
			const agent = await loginAgent(harness.server, harness.auth);
			const { body, contentType } = multipartBody(
				"urls.txt",
				Buffer.from("https://example.com/imported-a https://example.com/imported-b"),
			);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);

			await agent.post(`${create.headers.location}/commit`);

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "user must exist");
			const result = await articleStore.findArticlesByUser({ userId });
			expect(result.articles.map((article) => article.provenance)).toEqual([
				{ kind: "import" },
				{ kind: "import" },
			]);
		});

		it("stamps every URL of one commit batch with one savedAt, minted only after the batch's freshness checks resolved", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const events: string[] = [];
			const savedAts: Date[] = [];
			const harness = useApp({
				...fixture,
				freshness: {
					refreshArticleIfStale: async ({ url }) => {
						if (url.endsWith("/slow")) {
							await new Promise((resolve) => setTimeout(resolve, 20));
						}
						events.push(`refresh ${url}`);
						return { action: "new" };
					},
				},
				articleStore: {
					...fixture.articleStore,
					saveArticle: async (params) => {
						events.push(`save ${params.url}`);
						savedAts.push(params.savedAt);
						return fixture.articleStore.saveArticle(params);
					},
				},
			});
			const agent = await loginAgent(harness.server, harness.auth);
			const { body, contentType } = multipartBody(
				"urls.txt",
				Buffer.from("https://example.com/slow https://example.com/fast-1 https://example.com/fast-2"),
			);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);

			const commit = await agent.post(`${create.headers.location}/commit`);

			expect(commit.status).toBe(303);
			expect(events[2]).toBe("refresh https://example.com/slow");
			expect(events.slice(3).map((e) => e.split(" ")[0])).toEqual(["save", "save", "save"]);
			expect(savedAts).toHaveLength(3);
			expect(new Set(savedAts.map((d) => d.toISOString())).size).toBe(1);
		});

		it("imports the rest of a batch when one URL's store write throws", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				articleStore: {
					...fixture.articleStore,
					saveArticle: async (params) => {
						if (params.url.endsWith("/broken")) throw new Error("write exploded");
						return fixture.articleStore.saveArticle(params);
					},
				},
			});
			const { auth, articleStore } = harness;
			const agent = await loginAgent(harness.server, harness.auth);
			const { body, contentType } = multipartBody(
				"urls.txt",
				Buffer.from("https://example.com/broken https://example.com/healthy"),
			);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);

			const commit = await agent.post(`${create.headers.location}/commit`);

			expect(commit.status).toBe(303);
			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "user must exist");
			const stored = await articleStore.findArticlesByUser({ userId });
			expect(stored.articles.map((a) => a.url)).toEqual(["https://example.com/healthy"]);
		});

		it("imports the rest of a batch when one URL's freshness check throws", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp({
				...fixture,
				freshness: {
					refreshArticleIfStale: async ({ url }) => {
						if (url.endsWith("/broken")) throw new Error("crawl exploded");
						return { action: "new" };
					},
				},
			});
			const { auth, articleStore } = harness;
			const agent = await loginAgent(harness.server, harness.auth);
			const { body, contentType } = multipartBody(
				"urls.txt",
				Buffer.from("https://example.com/broken https://example.com/healthy"),
			);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);

			const commit = await agent.post(`${create.headers.location}/commit`);

			expect(commit.status).toBe(303);
			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "user must exist");
			const stored = await articleStore.findArticlesByUser({ userId });
			expect(stored.articles.map((a) => a.url)).toEqual(["https://example.com/healthy"]);
		});

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
			expect(reuse.headers.location).toBe("/import?mode=upload&error_code=import_session_not_found");
		});

		it("redirects when the session id is malformed", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/import/not-an-id/commit");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/import?mode=upload&error_code=import_session_not_found");
		});

		it("redirects when the session no longer exists", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/import/00000000000000000000000000000000/commit");

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/import?mode=upload&error_code=import_session_not_found");
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

	describe("POST /import/:id/commit write-access gating", () => {
		it("keeps the upload+review public but redirects the commit to /queue?inactive=1 for a trial-expired account", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = (await harness.auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "seeded login user must exist");
			// A trial past its window leaves the account read-only: the commit
			// (the bulk save) is gated by the write-access check while the upload
			// and review pages stay public.
			await harness.subscriptionProviders.upsertTrialing({
				userId,
				trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
			});

			const acquire = await agent.get("/import");
			expect(acquire.status).toBe(200);

			const create = await agent
				.post("/import/from-url")
				.type("form")
				.send({ url: "https://news.example/issues/7" });
			expect(create.status).toBe(303);
			const reviewPath = create.headers.location;

			const review = await agent.get(reviewPath);
			expect(review.status).toBe(200);

			const commit = await agent.post(`${reviewPath}/commit`).set("Accept", "text/html");
			expect(commit.status).toBe(303);
			expect(commit.headers.location).toBe("/queue?inactive=1");
		});
	});

	describe("Anonymous self-serve flow", () => {
		async function anonUpload(server: Parameters<typeof request>[0], content: string) {
			const { body, contentType } = multipartBody("urls.txt", Buffer.from(content));
			const create = await request(server)
				.post("/import")
				.set("Content-Type", contentType)
				.send(body);
			return create.headers.location;
		}

		it("renders the review screen with all URLs checked for an anonymous visitor", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const sessionPath = await anonUpload(
				harness.server,
				"https://example.com/a https://example.com/b https://example.com/c",
			);

			const response = await request(harness.server).get(sessionPath);

			expect(response.status).toBe(200);
			const doc = new JSDOM(response.text).window.document;
			const checkboxes = doc.querySelectorAll<HTMLInputElement>("[data-test-import-checkbox]");
			expect(checkboxes).toHaveLength(3);
			for (const cb of checkboxes) {
				expect(cb.hasAttribute("checked")).toBe(true);
			}
		});

		it("persists an anonymous toggle across requests (server-side selection state)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const sessionPath = await anonUpload(harness.server, "https://example.com/a https://example.com/b");

			const toggle = await request(harness.server)
				.post(`${sessionPath}/toggle`)
				.type("form")
				.send({ index: 0, checked: "false" });
			expect(toggle.status).toBe(303);

			const review = await request(harness.server).get(sessionPath);
			const doc = new JSDOM(review.text).window.document;
			const first = doc.querySelector<HTMLInputElement>('[data-test-import-checkbox="0"]');
			assert(first, "first checkbox must exist");
			expect(first.hasAttribute("checked")).toBe(false);
			expect(summaryText(doc)).toContain("1 of 2 selected");
		});

		it("redirects an anonymous commit to /signup carrying the session id in ?return=, without saving or deleting", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			const harness = useApp(fixture);
			const sessionPath = await anonUpload(harness.server, "https://example.com/a https://example.com/b");
			const id = sessionIdFromLocation(sessionPath);

			const commit = await request(harness.server).post(`${sessionPath}/commit`);

			expect(commit.status).toBe(303);
			expect(commit.headers.location).toBe(`/signup?return=${encodeURIComponent(`/import/${id}`)}`);
			const stillThere = await fixture.importSession.importSessionStore.findImportSession({
				id,
				userId: undefined,
			});
			expect(stillThere).toBeDefined();
		});

		it("redirects an anonymous commit with an unparseable id to a bare /signup", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

			const commit = await request(harness.server).post("/import/not-an-id/commit");

			expect(commit.status).toBe(303);
			expect(commit.headers.location).toBe("/signup");
		});

		it("lets a just-signed-up user reach the anonymous review with selections intact and commit it", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const { auth, articleStore } = harness;
			const sessionPath = await anonUpload(
				harness.server,
				"https://example.com/a https://example.com/b https://example.com/c",
			);
			await request(harness.server)
				.post(`${sessionPath}/toggle`)
				.type("form")
				.send({ index: 1, checked: "false" });

			// Simulate the post-signup return: the same session id, now reached by an
			// authenticated identity (capability access).
			const agent = await loginAgent(harness.server, auth);

			const review = await agent.get(sessionPath);
			expect(review.status).toBe(200);
			const doc = new JSDOM(review.text).window.document;
			const second = doc.querySelector<HTMLInputElement>('[data-test-import-checkbox="1"]');
			assert(second, "deselected checkbox must persist into the authenticated review");
			expect(second.hasAttribute("checked")).toBe(false);
			expect(summaryText(doc)).toContain("2 of 3 selected");

			const commit = await agent.post(`${sessionPath}/commit`);
			expect(commit.status).toBe(303);
			expect(commit.headers.location).toBe("/queue?import_imported=2&import_total=3&import_skipped=0");

			const userId = (await auth.findUserByEmail("test@example.com"))?.userId;
			assert(userId, "user must exist");
			const stored = await articleStore.findArticlesByUser({ userId });
			expect(stored.articles.map((a) => a.url).sort()).toEqual([
				"https://example.com/a",
				"https://example.com/c",
			]);

			const reuse = await agent.get(sessionPath);
			expect(reuse.status).toBe(303);
			expect(reuse.headers.location).toBe("/import?mode=upload&error_code=import_session_not_found");
		});

		it("refuses an anonymous caller access to a session owned by an authenticated user", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const owner = await loginAgent(harness.server, harness.auth);
			const { body, contentType } = multipartBody("urls.txt", Buffer.from("https://example.com/owned"));
			const create = await owner.post("/import").set("Content-Type", contentType).send(body);

			const response = await request(harness.server).get(create.headers.location);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/import?mode=upload&error_code=import_session_not_found");
		});
	});

	describe("Analytics events", () => {
		it("emits import_uploaded event with url_count after a successful upload", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const file = Buffer.from("https://example.com/post-1 https://example.com/post-2");
			const { body, contentType } = multipartBody("urls.txt", file);

			await agent.post("/import").set("Content-Type", contentType).send(body);

			const uploaded = harness.analytics.events.filter(
				(e): e is ImportUploadedEvent => e.event === "import_uploaded",
			);
			assert.equal(uploaded.length, 1, "exactly one import_uploaded event");
			assert.equal(uploaded[0].url_count, 2);
			assert.equal(uploaded[0].utm_source, "import-feature");
			assert.equal(uploaded[0].utm_medium, "form");
			assert.equal(uploaded[0].utm_campaign, "file-upload");
			assert.equal(uploaded[0].is_authenticated, 1);
		});

		it("emits import_uploaded with is_authenticated=0 for an anonymous upload", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const file = Buffer.from("https://example.com/post-1 https://example.com/post-2");
			const { body, contentType } = multipartBody("urls.txt", file);

			await request(harness.server).post("/import").set("Content-Type", contentType).send(body);

			const uploaded = harness.analytics.events.filter(
				(e): e is ImportUploadedEvent => e.event === "import_uploaded",
			);
			assert.equal(uploaded.length, 1, "exactly one import_uploaded event");
			assert.equal(uploaded[0].is_authenticated, 0);
		});

		it("emits import_committed event with correct counts after a successful commit", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);
			const file = Buffer.from(
				"https://example.com/a https://example.com/b http://localhost/invalid",
			);
			const { body, contentType } = multipartBody("urls.txt", file);
			const create = await agent.post("/import").set("Content-Type", contentType).send(body);
			const sessionPath = create.headers.location;

			await agent.post(`${sessionPath}/commit`);

			const committed = harness.analytics.events.filter(
				(e): e is ImportCommittedEvent => e.event === "import_committed",
			);
			assert.equal(committed.length, 1, "exactly one import_committed event");
			assert.equal(committed[0].imported_count, 2);
			assert.equal(committed[0].skipped_count, 1);
			assert.equal(committed[0].total_in_session, 3);
			assert.equal(committed[0].utm_source, "import-feature");
			assert.equal(committed[0].utm_medium, "form");
			assert.equal(committed[0].utm_campaign, "submit");
			assert.equal(committed[0].is_authenticated, 1);
		});

		it("does not emit analytics events on error paths (tooLarge, noUrls, sessionNotFound)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const oversize = Buffer.alloc(6 * 1024 * 1024, 0x41);
			const { body: largeBody, contentType: largeType } = multipartBody("big.bin", oversize);
			await agent.post("/import").set("Content-Type", largeType).send(largeBody);

			const { body: emptyBody, contentType: emptyType } = multipartBody("empty.txt", Buffer.from("just prose"));
			await agent.post("/import").set("Content-Type", emptyType).send(emptyBody);

			await agent.post("/import/00000000000000000000000000000000/commit");

			assert.equal(
				harness.analytics.events.filter((e) => e.event === "import_uploaded" || e.event === "import_committed").length,
				0,
				"no import analytics events on error paths",
			);
		});
	});

	describe("rate limiting", () => {
		it("returns 429 past the per-IP import upload limit", async () => {
			const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
			fixture.rateLimit = {
				consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
				rules: { ...fixture.rateLimit.rules, import: { limit: 1, windowSeconds: 3600 } },
			};
			const harness = useApp(fixture);
			const { body, contentType } = multipartBody("urls.txt", Buffer.from("https://example.com/a"));

			const first = await request(harness.server).post("/import").set("Content-Type", contentType).send(body);
			const throttled = await request(harness.server).post("/import").set("Content-Type", contentType).send(body);

			expect(first.status).toBe(303);
			expect(throttled.status).toBe(429);
			expect(String(throttled.headers["retry-after"])).toMatch(/^\d+$/);
		});
	});
});
