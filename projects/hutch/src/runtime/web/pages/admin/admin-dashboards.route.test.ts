import assert from "node:assert/strict";
import type { Server } from "node:http";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { initInMemoryLogsInsights } from "@packages/test-fixtures/providers/logs-insights";
import { buildAdminDashboards } from "../../../observability/admin-dashboards";
import { useTestServer } from "../../../test-app";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const USER_EMAIL = "alex@example.com";
const USER_PASSWORD = "password456";
const NOW = new Date("2026-10-18T06:00:00.000Z");
const DAY_MS = 86_400_000;
const EXCLUDED = {
	excludedVisitorIds: ["293b32c4-898e-485d-8a92-3f2f32f53289"],
	excludedUserIds: ["f19792f1a14cf1d500de060278ab4bc3"],
};
const DASHBOARDS = buildAdminDashboards({
	analyticsLogGroupName: "/readplace/analytics",
	authDiagnosticsLogGroupName: "/readplace/auth-diagnostics",
});

const useApp = useTestServer();

function buildHarness(input: { logsInsights: ReturnType<typeof initInMemoryLogsInsights>; readExcludedIdentities?: () => Promise<typeof EXCLUDED> }) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	return useApp({
		...fixture,
		admin: { adminEmails: [ADMIN_EMAIL], recrawlServiceToken: fixture.admin.recrawlServiceToken },
		adminDashboards: {
			runLogsInsightsQuery: input.logsInsights.runLogsInsightsQuery,
			readExcludedIdentities: input.readExcludedIdentities ?? (async () => EXCLUDED),
			now: () => NOW,
		},
	});
}

async function loginAs(input: { server: Server; email: string; password: string }) {
	const agent = request.agent(input.server);
	await agent.post("/login").type("form").send({ email: input.email, password: input.password });
	return agent;
}

async function adminAgent(harness: ReturnType<typeof buildHarness>) {
	await harness.auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
	return loginAs({ server: harness.server, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
}

function readWidgets(document: Document) {
	return Array.from(document.querySelectorAll("[data-test-admin-dashboard-widget]")).map((widget) => {
		const empty = widget.querySelector("[data-test-admin-dashboard-empty]");
		assert(empty, "every widget renders its empty state");
		const table = widget.querySelector("[data-test-admin-dashboard-table]");
		return {
			title: widget.querySelector("[data-test-admin-dashboard-widget-title]")?.textContent,
			empty: empty.getAttribute("data-test-admin-dashboard-empty"),
			columns: Array.from(table?.querySelectorAll("[data-test-admin-dashboard-column]") ?? []).map((column) => column.textContent),
			rows: Array.from(table?.querySelectorAll("[data-test-admin-dashboard-row]") ?? []).map((row) =>
				Array.from(row.querySelectorAll("[data-test-admin-dashboard-cell]")).map((cell) => [
					cell.getAttribute("data-label"),
					cell.textContent,
				]),
			),
			multiples: Array.from(widget.querySelectorAll("[data-test-admin-dashboard-multiple]")).map((multiple) => [
				multiple.getAttribute("data-test-admin-dashboard-multiple"),
				multiple.querySelectorAll("[data-test-admin-dashboard-point]").length,
			]),
		};
	});
}

function formOf(form: Element | null) {
	assert(form, "the control is a form");
	return [
		form.getAttribute("method"),
		form.getAttribute("action"),
		Object.fromEntries(
			Array.from(form.querySelectorAll('input[type="hidden"]')).map((input) => [
				input.getAttribute("name"),
				input.getAttribute("value"),
			]),
		),
	];
}

describe("GET /admin/dashboards", () => {
	it("lists every dashboard for an admin, each link tracked", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards");

		assert.equal(response.status, 200);
		assert.equal(response.headers["cache-control"], "no-store");
		const document = new JSDOM(response.text).window.document;
		const links = Array.from(document.querySelectorAll("[data-test-admin-dashboard-link]")).map((button) => [
			button.getAttribute("data-test-admin-dashboard-link"),
			...formOf(button.closest("form")),
		]);
		const tracked = (content: string) => ({ utm_source: "admin-dashboard", utm_medium: "internal", utm_content: content });
		assert.deepEqual(links, [
			["hn-experiment", "GET", "/admin/dashboards/hn-experiment", tracked("hn-experiment")],
			["mcp", "GET", "/admin/dashboards/mcp", tracked("mcp")],
			["login", "GET", "/admin/dashboards/login", tracked("login")],
		]);
	});

	it("sends a signed-out visitor to login", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });

		const response = await request(harness.server).get("/admin/dashboards/hn-experiment");

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
	});

	it("refuses a signed-in reader who is not an admin, without running a query", async () => {
		const logsInsights = initInMemoryLogsInsights();
		const harness = buildHarness({ logsInsights });
		await harness.auth.createUser({ email: USER_EMAIL, password: USER_PASSWORD });
		const agent = await loginAs({ server: harness.server, email: USER_EMAIL, password: USER_PASSWORD });

		const response = await agent.get("/admin/dashboards/hn-experiment");

		assert.equal(response.status, 403);
		assert.deepEqual(logsInsights.runQueries, []);
	});

	it("answers 404 for a dashboard that does not exist", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards/billing");

		assert.equal(response.status, 404);
	});
});

describe("GET /admin/dashboards/hn-experiment", () => {
	it("runs every widget's query over the last 7 days with the audience exclusions, and renders the seeded rows in widget order", async () => {
		const widgets = DASHBOARDS["hn-experiment"].widgets(EXCLUDED);
		const [latestReport, , activatedOverTime] = widgets;
		const logsInsights = initInMemoryLogsInsights();
		logsInsights.answerQuery({
			queryString: latestReport.query,
			rows: [
				[
					{ field: "campaign_id", value: "hn-starter-2026-09" },
					{ field: "as_of", value: "2026-10-18 00:00:00.000" },
					{ field: "verdict", value: "inconclusive" },
					{ field: "p_value", value: "0.0412345678" },
					{ field: "t_assigned", value: "1234" },
				],
				[
					{ field: "campaign_id", value: "hn-starter-2026-10" },
					{ field: "t_assigned", value: "88" },
				],
			],
		});
		logsInsights.answerQuery({
			queryString: activatedOverTime.query,
			rows: [
				[
					{ field: "bin(6h)", value: "2026-10-17 18:00:00.000" },
					{ field: "treatment_activated", value: "40" },
					{ field: "comparison_activated", value: "31" },
				],
				[
					{ field: "bin(6h)", value: "2026-10-17 12:00:00.000" },
					{ field: "treatment_activated", value: "38" },
					{ field: "comparison_activated", value: "30" },
				],
			],
		});
		const harness = buildHarness({ logsInsights });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards/hn-experiment");

		assert.equal(response.status, 200);
		assert.equal(response.headers["cache-control"], "no-store");
		const window = { startTime: new Date(NOW.getTime() - 7 * DAY_MS), endTime: NOW };
		assert.deepEqual(
			logsInsights.runQueries,
			widgets.map((spec) => ({ logGroupNames: ["/readplace/analytics"], queryString: spec.query, ...window })),
		);
		assert.equal(
			widgets.filter((spec) => spec.query.includes(EXCLUDED.excludedUserIds[0])).length,
			3,
			"the three per-account widgets drop the excluded identities",
		);
		const document = new JSDOM(response.text).window.document;
		assert.equal(document.querySelector("[data-test-admin-dashboard]")?.getAttribute("data-test-admin-dashboard"), "hn-experiment");
		assert.equal(document.querySelector("[data-test-admin-dashboard-window]")?.textContent, "Oct 11, 2026, 06:00 UTC – Oct 18, 2026, 06:00 UTC");
		assert.deepEqual(readWidgets(document), [
			{
				title: "Hacker News starter — latest experiment report (logged every 6 hours)",
				empty: "false",
				columns: ["campaign_id", "as_of", "verdict", "p_value", "t_assigned"],
				rows: [
					[["campaign_id", "hn-starter-2026-09"], ["as_of", "2026-10-18 00:00:00.000"], ["verdict", "inconclusive"], ["p_value", "0.0412"], ["t_assigned", "1,234"]],
					[["campaign_id", "hn-starter-2026-10"], ["as_of", "—"], ["verdict", "—"], ["p_value", "—"], ["t_assigned", "88"]],
				],
				multiples: [],
			},
			{ title: "Hacker News starter — latest report by tier and account cohort", empty: "true", columns: [], rows: [], multiples: [] },
			{
				title: "Hacker News starter — activated and mature accounts by arm over time",
				empty: "false",
				columns: ["bin(6h)", "treatment_activated", "comparison_activated"],
				rows: [
					[["bin(6h)", "2026-10-17 18:00:00.000"], ["treatment_activated", "40"], ["comparison_activated", "31"]],
					[["bin(6h)", "2026-10-17 12:00:00.000"], ["treatment_activated", "38"], ["comparison_activated", "30"]],
				],
				multiples: [["treatment_activated", 2], ["comparison_activated", 2]],
			},
			{ title: "Hacker News starter — assignments, insertions and delivery outcomes", empty: "true", columns: [], rows: [], multiples: [] },
			{ title: "Hacker News starter — reader visits, suggestion reads and personal saves", empty: "true", columns: [], rows: [], multiples: [] },
			{ title: "Hacker News starter — unsubscribes by original assignment", empty: "true", columns: [], rows: [], multiples: [] },
		]);
	});

	it("offers the next longer range from an empty widget, tracked", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards/hn-experiment?range=30d");

		const document = new JSDOM(response.text).window.document;
		const widget = document.querySelector("[data-test-admin-dashboard-widget]");
		assert(widget, "the first widget renders");
		assert.equal(widget.querySelector(".admin-dashboard__empty-text")?.textContent, "No matching events in the last 30 days");
		const action = widget.querySelector("[data-test-admin-dashboard-empty-action]");
		assert(action, "an empty widget offers a longer range");
		assert.equal(action.textContent, "Try the last 90 days");
		assert.deepEqual(formOf(action.closest("form")), [
			"GET",
			"/admin/dashboards/hn-experiment",
			{ range: "90d", utm_source: "admin-dashboard", utm_medium: "internal", utm_content: "empty-range-90d" },
		]);
	});

	it("offers no longer range once the widest is selected", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards/hn-experiment?range=90d");

		const document = new JSDOM(response.text).window.document;
		assert.equal(document.querySelectorAll("[data-test-admin-dashboard-empty-action]").length, 0);
		assert.equal(
			document.querySelector(".admin-dashboard__empty-text")?.textContent,
			"No matching events in the last 90 days",
		);
	});

	it("marks the chosen range and queries its window; an unknown range falls back to 7 days", async () => {
		const logsInsights = initInMemoryLogsInsights();
		const harness = buildHarness({ logsInsights });
		const agent = await adminAgent(harness);

		const day = await agent.get("/admin/dashboards/hn-experiment?range=1d");
		const fallback = await agent.get("/admin/dashboards/hn-experiment?range=forever");

		const ranges = (text: string) =>
			Array.from(new JSDOM(text).window.document.querySelectorAll("[data-test-admin-dashboard-range]")).map((button) => [
				button.getAttribute("data-test-admin-dashboard-range"),
				button.getAttribute("aria-current"),
				...formOf(button.closest("form")).slice(2),
			]);
		const tracked = (range: string) => ({ range, utm_source: "admin-dashboard", utm_medium: "internal", utm_content: `range-${range}` });
		assert.deepEqual(ranges(day.text), [
			["1d", "page", tracked("1d")],
			["7d", "false", tracked("7d")],
			["30d", "false", tracked("30d")],
			["90d", "false", tracked("90d")],
		]);
		assert.equal(ranges(fallback.text)[1][1], "page");
		assert.deepEqual(
			[...new Set(logsInsights.runQueries.map((query) => (query.endTime.getTime() - query.startTime.getTime()) / DAY_MS))],
			[1, 7],
		);
	});
});

describe("GET /admin/dashboards/mcp", () => {
	it("draws one small multiple per series of a time-series widget on a shared window", async () => {
		const widgets = DASHBOARDS.mcp.widgets(EXCLUDED);
		const perDay = widgets[1];
		const logsInsights = initInMemoryLogsInsights();
		logsInsights.answerQuery({
			queryString: perDay.query,
			rows: [
				[{ field: "bin(1d)", value: "2026-10-16 00:00:00.000" }, { field: "outcome", value: "ok" }, { field: "calls", value: "12" }],
				[{ field: "bin(1d)", value: "2026-10-17 00:00:00.000" }, { field: "outcome", value: "ok" }, { field: "calls", value: "9" }],
				[{ field: "bin(1d)", value: "2026-10-17 00:00:00.000" }, { field: "outcome", value: "error" }, { field: "calls", value: "2" }],
			],
		});
		const harness = buildHarness({ logsInsights });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards/mcp");

		assert.equal(response.status, 200);
		const document = new JSDOM(response.text).window.document;
		const readWidget = readWidgets(document)[1];
		assert.deepEqual(
			[readWidget.title, readWidget.multiples],
			["MCP tool calls per day by outcome", [["ok · calls", 2], ["error · calls", 1]]],
		);
	});
});

describe("GET /admin/dashboards/login", () => {
	it("queries the analytics and auth-diagnostics groups without reading the exclusion parameter", async () => {
		const logsInsights = initInMemoryLogsInsights();
		const harness = buildHarness({
			logsInsights,
			readExcludedIdentities: async () => {
				throw new Error("the login dashboard must not read the exclusion parameter");
			},
		});
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards/login");

		assert.equal(response.status, 200);
		assert.deepEqual(
			logsInsights.runQueries.map((query) => query.logGroupNames),
			[
				["/readplace/analytics"],
				["/readplace/analytics"],
				["/readplace/auth-diagnostics"],
				["/readplace/auth-diagnostics"],
				["/readplace/auth-diagnostics"],
				["/readplace/auth-diagnostics"],
				["/readplace/auth-diagnostics"],
			],
		);
		assert.deepEqual(
			readWidgets(new JSDOM(response.text).window.document).map((widget) => widget.title),
			[
				"OAuth token grants — issued vs refused by client",
				"OAuth token revocations — per day by client × outcome",
				"Authentication failures by client and version",
				"Interrupted refresh checkpoints",
				"Repeated transport requests",
				"Session deletion and bridge failures",
				"Journal and storage health",
			],
		);
	});
});
