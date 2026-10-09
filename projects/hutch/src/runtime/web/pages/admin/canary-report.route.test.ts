import assert from "node:assert/strict";
import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { CanaryReportSourceSchema } from "@packages/provider-contracts/canary-report";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const USER_EMAIL = "alex@example.com";
const USER_PASSWORD = "password456";

const useApp = useTestServer();
function buildHarness(fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN)) {
	return useApp({
		...fixture,
		admin: {
			adminEmails: [ADMIN_EMAIL],
			recrawlServiceToken: fixture.admin.recrawlServiceToken,
		},
	});
}

async function loginAs(input: { server: Server; email: string; password: string }) {
	const agent = request.agent(input.server);
	await agent.post("/login").type("form").send({ email: input.email, password: input.password });
	return agent;
}

function textOf(scope: ParentNode, selector: string): string | null {
	const element = scope.querySelector(selector);
	assert(element, `${selector} must be rendered`);
	return element.textContent;
}

function readRows(document: Document) {
	return Array.from(document.querySelectorAll("[data-test-canary-report-row]")).map((row) => {
		const original = row.querySelector("[data-test-canary-report-original]");
		assert(original, "every row shows its URL");
		const recrawl = row.querySelector("[data-test-canary-report-recrawl]");
		assert(recrawl, "every row has a recrawl form");
		return {
			row: row.getAttribute("data-test-canary-report-row"),
			number: textOf(row, "[data-test-canary-report-number]"),
			original: original.getAttribute("data-test-canary-report-original"),
			href: original.getAttribute("href"),
			url: original.textContent,
			labels: Array.from(row.querySelectorAll("[data-test-canary-report-label]")).map((label) => label.textContent),
			detail: textOf(row, "[data-test-canary-report-detail]"),
			times: textOf(row, "[data-test-canary-report-times]"),
			recrawl: [
				recrawl.getAttribute("method"),
				recrawl.getAttribute("action"),
				Object.fromEntries(
					Array.from(recrawl.querySelectorAll('input[type="hidden"]')).map((input) => [
						input.getAttribute("name"),
						input.getAttribute("value"),
					]),
				),
			],
		};
	});
}

describe("GET /admin/canary-reports/:canary/:source", () => {
	it("shows an admin every row of a failed-articles report, each with its URL, reason and a recrawl button", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		await fixture.canaryReports.saveCanaryReport({
			canary: "failed-articles",
			source: CanaryReportSourceSchema.parse("run-37967705297-2"),
			runUrl: "https://github.test/readplace/actions/runs/37967705297",
			createdAt: "2026-10-10T20:00:05.000Z",
			rows: [
				{
					url: "https://site.test/post?ref=feed&id=7",
					labels: ["crawl-failed", "summary-failed"],
					detail: 'crawl-failed: {"kind":"blocked","cause":"edge-block"} | summary-failed: {"kind":"crawl-failed"}',
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: "2026-10-02T09:30:00.000Z",
				},
				{
					url: "chrome://newtab/",
					labels: ["crawl-failed"],
					detail: "(no stored reason)",
					savedAt: "2026-10-03T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
			],
		});
		const harness = buildHarness(fixture);
		await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
		const agent = await loginAs({ server: harness.server, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

		const response = await agent.get("/admin/canary-reports/failed-articles/run-37967705297-2");

		assert.equal(response.status, 200);
		assert.equal(response.headers["cache-control"], "no-store");
		const document = new JSDOM(response.text).window.document;
		assert.equal(document.body.classList.contains("page-admin-canary-report"), true);
		assert.equal(document.querySelector('meta[name="robots"]')?.getAttribute("content"), "noindex, nofollow");
		assert.equal(
			document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
			"https://readplace.com/admin/canary-reports/failed-articles/run-37967705297-2",
		);
		assert.equal(document.querySelector("[data-test-admin-canary-report]")?.getAttribute("data-test-admin-canary-report"), "failed-articles");
		assert.equal(textOf(document, "h1"), "Failed articles canary report");
		const run = document.querySelector("[data-test-canary-report-run]");
		assert(run, "the report links the run that wrote it");
		assert.deepEqual([run.getAttribute("href"), run.textContent], [
			"https://github.test/readplace/actions/runs/37967705297",
			"https://github.test/readplace/actions/runs/37967705297",
		]);
		assert.equal(textOf(document, "[data-test-canary-report-created]"), "2026-10-10T20:00:05.000Z");
		assert.equal(textOf(document, "[data-test-canary-report-row-count]"), "2");
		const recrawlOf = (url: string) => [
			"GET",
			"/admin/recrawl",
			{ url, utm_source: "admin-canary-report", utm_medium: "internal", utm_content: "recrawl" },
		];
		assert.deepEqual(readRows(document), [
			{
				row: "1",
				number: "1",
				original: "link",
				href: "https://site.test/post?ref=feed&id=7",
				url: "https://site.test/post?ref=feed&id=7",
				labels: ["crawl-failed", "summary-failed"],
				detail: 'crawl-failed: {"kind":"blocked","cause":"edge-block"} | summary-failed: {"kind":"crawl-failed"}',
				times: "saved 2026-10-01T08:00:00.000Z · fetched 2026-10-02T09:30:00.000Z",
				recrawl: recrawlOf("https://site.test/post?ref=feed&id=7"),
			},
			{
				row: "2",
				number: "2",
				original: "text",
				href: null,
				url: "chrome://newtab/",
				labels: ["crawl-failed"],
				detail: "(no stored reason)",
				times: "saved 2026-10-03T08:00:00.000Z · fetched -",
				recrawl: recrawlOf("chrome://newtab/"),
			},
		]);
	});

	it("titles a stuck-articles report and shows a URL without a scheme as text", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		await fixture.canaryReports.saveCanaryReport({
			canary: "stuck-articles",
			source: CanaryReportSourceSchema.parse("issue-226-comment-4366291266"),
			runUrl: "https://github.test/readplace/actions/runs/226",
			createdAt: "2026-06-01T19:31:00.000Z",
			rows: [
				{
					url: "legacy.test/stuck",
					labels: ["crawl-pending"],
					detail: "crawlStatus is 'pending'",
					savedAt: undefined,
					contentFetchedAt: "2026-05-31T11:00:00.000Z",
				},
			],
		});
		const harness = buildHarness(fixture);
		await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
		const agent = await loginAs({ server: harness.server, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

		const response = await agent.get("/admin/canary-reports/stuck-articles/issue-226-comment-4366291266");

		assert.equal(response.status, 200);
		const document = new JSDOM(response.text).window.document;
		assert.equal(document.querySelector("[data-test-admin-canary-report]")?.getAttribute("data-test-admin-canary-report"), "stuck-articles");
		assert.equal(textOf(document, "h1"), "Stuck articles canary report");
		assert.deepEqual(
			readRows(document).map((row) => [row.original, row.href, row.url, row.times]),
			[["text", null, "legacy.test/stuck", "saved - · fetched 2026-05-31T11:00:00.000Z"]],
		);
	});

	it("sends a signed-out visitor to login without showing a saved report", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		await fixture.canaryReports.saveCanaryReport({
			canary: "failed-articles",
			source: CanaryReportSourceSchema.parse("run-1-1"),
			runUrl: "https://github.test/readplace/actions/runs/1",
			createdAt: "2026-10-10T20:00:05.000Z",
			rows: [
				{
					url: "https://site.test/post?token=reader-7f3a",
					labels: ["crawl-failed"],
					detail: "(no stored reason)",
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
			],
		});
		const harness = buildHarness(fixture);

		const response = await request(harness.server).get("/admin/canary-reports/failed-articles/run-1-1");

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
		assert.deepEqual(readRows(new JSDOM(response.text).window.document), []);
		assert.equal(response.text.includes("reader-7f3a"), false);
	});

	it("does not accept the recrawl service token in place of a session for a saved report", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		await fixture.canaryReports.saveCanaryReport({
			canary: "failed-articles",
			source: CanaryReportSourceSchema.parse("run-1-1"),
			runUrl: "https://github.test/readplace/actions/runs/1",
			createdAt: "2026-10-10T20:00:05.000Z",
			rows: [
				{
					url: "https://site.test/post?token=reader-7f3a",
					labels: ["crawl-failed"],
					detail: "(no stored reason)",
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
			],
		});
		const harness = buildHarness(fixture);

		const response = await request(harness.server)
			.get("/admin/canary-reports/failed-articles/run-1-1")
			.set("x-service-token", fixture.admin.recrawlServiceToken);

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
		assert.deepEqual(readRows(new JSDOM(response.text).window.document), []);
		assert.equal(response.text.includes("reader-7f3a"), false);
	});

	it("refuses a signed-in reader who is not an admin without showing a saved report", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		await fixture.canaryReports.saveCanaryReport({
			canary: "failed-articles",
			source: CanaryReportSourceSchema.parse("run-1-1"),
			runUrl: "https://github.test/readplace/actions/runs/1",
			createdAt: "2026-10-10T20:00:05.000Z",
			rows: [
				{
					url: "https://site.test/post?token=reader-7f3a",
					labels: ["crawl-failed"],
					detail: "(no stored reason)",
					savedAt: "2026-10-01T08:00:00.000Z",
					contentFetchedAt: undefined,
				},
			],
		});
		const harness = buildHarness(fixture);
		await harness.auth.createUser({ email: USER_EMAIL, password: USER_PASSWORD });
		const agent = await loginAs({ server: harness.server, email: USER_EMAIL, password: USER_PASSWORD });

		const response = await agent.get("/admin/canary-reports/failed-articles/run-1-1");

		assert.equal(response.status, 403);
		const document = new JSDOM(response.text).window.document;
		assert.equal(document.body.classList.contains("page-admin-forbidden"), true);
		assert.deepEqual(readRows(document), []);
		assert.equal(response.text.includes("reader-7f3a"), false);
	});

	it("answers not found for a report nobody saved, a canary that does not exist and a malformed source", async () => {
		const harness = buildHarness();
		await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
		const agent = await loginAs({ server: harness.server, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

		const answers = [];
		for (const path of [
			"/admin/canary-reports/failed-articles/run-1-1",
			"/admin/canary-reports/lost-articles/run-1-1",
			"/admin/canary-reports/failed-articles/run-1",
		]) {
			const response = await agent.get(path);
			const document = new JSDOM(response.text).window.document;
			answers.push([path, response.status, document.body.classList.contains("page-not-found")]);
		}

		assert.deepEqual(answers, [
			["/admin/canary-reports/failed-articles/run-1-1", 404, true],
			["/admin/canary-reports/lost-articles/run-1-1", 404, true],
			["/admin/canary-reports/failed-articles/run-1", 404, true],
		]);
	});
});
