import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { hashPassword, verifyPassword } from "@packages/domain/user";
import { type Logger, noopLogger } from "@packages/logger";
import { GlobalNav, HtmxLoaded, initBase } from "@packages/web-shell";
import { SESSION_COOKIE_NAME, initResolveLogin } from "@packages/web-session";
import { useLoopbackServer } from "@packages/web-test-harness";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { initInMemoryLogsInsights } from "@packages/test-fixtures/providers/logs-insights";
import type { ReadExcludedIdentities } from "@packages/provider-contracts/logs-insights";
import type { GetParameterCommand } from "@aws-sdk/client-ssm";
import { EXCLUDED_IDENTITIES_PARAMETER_NAME, buildAdminDashboards, parseExcludedIdentities } from "@packages/dashboard-widgets";
import { createAdminDashboardsApp } from "../app";
import { initSsmExcludedIdentities } from "../providers/excluded-identities/ssm-excluded-identities";
import { initAdminDashboardResults } from "./admin-dashboard-results";

const ADMIN_EMAIL = "ops@readplace.com";
const ADMIN_PASSWORD = "password123";
const USER_EMAIL = "alex@example.com";
const USER_PASSWORD = "password456";
const NOW = new Date("2026-10-18T06:00:00.000Z");
const DAY_MS = 86_400_000;
const HOUR_SECONDS = 3_600;
const EXCLUDED = {
	excludedVisitorIds: ["293b32c4-898e-485d-8a92-3f2f32f53289"],
	excludedUserIds: ["f19792f1a14cf1d500de060278ab4bc3"],
};
const DASHBOARDS = buildAdminDashboards();

const serve = useLoopbackServer();

function buildHarness(input: {
	logsInsights: ReturnType<typeof initInMemoryLogsInsights>;
	readExcludedIdentities?: ReadExcludedIdentities;
	runLogsInsightsQuery?: ReturnType<typeof initInMemoryLogsInsights>["runLogsInsightsQuery"];
	now?: () => Date;
}) {
	const auth = initInMemoryAuth({ hashPassword, verifyPassword, now: () => new Date() });
	const loggedErrors: string[] = [];
	const logger: Logger = {
		info: () => {},
		warn: () => {},
		debug: () => {},
		error: (...args) => {
			loggedErrors.push(String(args[0]));
		},
	};
	const now = input.now ?? (() => NOW);
	const app = createAdminDashboardsApp({
		base: initBase({ staticBaseUrl: "", liveReload: false, renderNav: GlobalNav, htmx: HtmxLoaded }),
		resolveLogin: initResolveLogin({ getSessionUserId: auth.getSessionUserId, logger }),
		findUserByEmail: auth.findUserByEmail,
		findSessionAdminMfaVerifiedAt: auth.findSessionAdminMfaVerifiedAt,
		adminEmails: [ADMIN_EMAIL],
		dashboards: DASHBOARDS,
		runLogsInsightsQuery: input.runLogsInsightsQuery ?? input.logsInsights.runLogsInsightsQuery,
		readExcludedIdentities: input.readExcludedIdentities ?? (async () => EXCLUDED),
		...initAdminDashboardResults(),
		analyticsLogger: noopLogger,
		logger,
		salt: "test-salt",
		now,
		generateVisitorId: () => "a2f0c3c4-1b7e-4d2a-9f38-6f1d2a7e9b10",
		secureCookies: false,
		ownHost: "127.0.0.1",
		edgeSecret: "test-edge-secret",
	});
	return { server: serve(app), auth, loggedErrors, nowSeconds: () => Math.floor(now().getTime() / 1000) };
}

type Harness = ReturnType<typeof buildHarness>;

async function signIn(
	harness: Harness,
	input: { email: string; password: string; adminMfaVerifiedAt?: number; ageLocked?: boolean },
) {
	const created = await harness.auth.createUser({ email: input.email, password: input.password });
	assert(created.ok, "the test user is new");
	if (input.ageLocked) await harness.auth.markAgeLocked({ userId: created.userId, at: NOW.toISOString() });
	const sessionId = await harness.auth.createSession({ userId: created.userId, emailVerified: true });
	if (input.adminMfaVerifiedAt !== undefined) {
		await harness.auth.markSessionAdminMfaVerified({
			sessionId,
			at: input.adminMfaVerifiedAt,
			email: input.email,
			totpStep: 1,
		});
	}
	return request.agent(harness.server).set("Cookie", `${SESSION_COOKIE_NAME}=${sessionId}`);
}

async function adminAgent(harness: Harness) {
	return signIn(harness, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, adminMfaVerifiedAt: harness.nowSeconds() });
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
			["keep-engine", "GET", "/admin/dashboards/keep-engine", tracked("keep-engine")],
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
		const agent = await signIn(harness, { email: USER_EMAIL, password: USER_PASSWORD });

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

	it("sends an admin who has not passed the second factor to the challenge", async () => {
		const logsInsights = initInMemoryLogsInsights();
		const harness = buildHarness({ logsInsights });
		const agent = await signIn(harness, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

		const response = await agent.get("/admin/dashboards/hn-experiment");

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/admin/mfa");
		assert.deepEqual(logsInsights.runQueries, []);
	});

	it("sends an admin whose second factor is older than 12 hours back to the challenge", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });
		const agent = await signIn(harness, {
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD,
			adminMfaVerifiedAt: harness.nowSeconds() - 12 * HOUR_SECONDS,
		});

		const response = await agent.get("/admin/dashboards");

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/admin/mfa");
	});

	it("sends a caller holding only a service token to login, uncached", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });

		const response = await request(harness.server).get("/admin/dashboards").set("x-service-token", "any-token");

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
		assert.equal(response.headers["cache-control"], "no-store");
	});

	it("sends an age-locked admin to login, where the paused account is handled", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });
		const agent = await signIn(harness, {
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD,
			adminMfaVerifiedAt: harness.nowSeconds(),
			ageLocked: true,
		});

		const response = await agent.get("/admin/dashboards");

		assert.equal(response.status, 303);
		assert.equal(response.headers.location, "/login");
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

describe("GET /admin/dashboards/:slug when a widget query fails", () => {
	it("aborts every sibling query and answers 500", async () => {
		const widgets = DASHBOARDS.mcp.widgets(EXCLUDED);
		const logsInsights = initInMemoryLogsInsights();
		logsInsights.failQuery({ queryString: widgets[1].query, error: new Error("Logs Insights query query-7 ended Timeout") });
		const harness = buildHarness({ logsInsights });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards/mcp");

		assert.equal(response.status, 500);
		assert.equal(harness.loggedErrors.length, 1);
		assert.match(harness.loggedErrors[0], /Logs Insights query query-7 ended Timeout/);
		assert.equal(logsInsights.signals.length, widgets.length);
		assert.deepEqual(
			logsInsights.signals.map((signal) => signal.reason?.message),
			widgets.map(() => "Logs Insights query query-7 ended Timeout"),
		);
	});
});

describe("GET /admin/dashboards/:slug period switching", () => {
	it("syncs the range tabs and the empty-widget range buttons on the dashboard, so a new click replaces the request in flight", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards/hn-experiment?range=30d");

		const document = new JSDOM(response.text).window.document;
		const main = document.querySelector("main[data-test-admin-dashboard]");
		assert(main, "the dashboard renders its main element");
		assert.equal(main.getAttribute("hx-sync"), "this:replace");
		const buttons = Array.from(
			document.querySelectorAll("[data-test-admin-dashboard-range], [data-test-admin-dashboard-empty-action]"),
		);
		assert.ok(document.querySelectorAll("[data-test-admin-dashboard-empty-action]").length > 0);
		for (const button of buttons) {
			assert.equal(button.closest("form")?.closest("[hx-sync]"), main);
		}
	});
});

function inFlightTargets(input: { document: Document; button: Element }) {
	const form = input.button.closest("form");
	assert(form, "the control is a form");
	const carrier = form.closest("[hx-indicator]");
	assert(carrier, "the form inherits an hx-indicator");
	const indicator = carrier.getAttribute("hx-indicator");
	assert(indicator, "the hx-indicator names its targets");
	return indicator.split(",").flatMap((part) => {
		const selector = part.trim();
		const targets = selector.startsWith("closest ")
			? [form.closest(selector.slice("closest ".length))].filter((target) => target !== null)
			: Array.from(input.document.querySelectorAll(selector));
		assert.ok(targets.length > 0, `"${selector}" resolves to an element`);
		return targets;
	});
}

describe("GET /admin/dashboards/:slug while a range loads", () => {
	it("marks the pressed tab's form, the strip, the window line and every widget", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards/hn-experiment");

		const document = new JSDOM(response.text).window.document;
		const nav = document.querySelector("nav.admin-dashboard__ranges");
		const windowLine = document.querySelector("[data-test-admin-dashboard-window]");
		const widgets = Array.from(document.querySelectorAll("[data-test-admin-dashboard-widget]"));
		assert(nav, "the range strip renders");
		assert(windowLine, "the window line renders");
		const buttons = Array.from(document.querySelectorAll("[data-test-admin-dashboard-range]"));
		assert.equal(buttons.length, 4);
		for (const button of buttons) {
			assert.deepEqual(inFlightTargets({ document, button }), [button.closest("form"), nav, windowLine, ...widgets]);
		}
	});

	it("dims the same region for an empty widget's longer range, and leaves the strip alone", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });
		const agent = await adminAgent(harness);

		const response = await agent.get("/admin/dashboards/hn-experiment?range=30d");

		const document = new JSDOM(response.text).window.document;
		const nav = document.querySelector("nav.admin-dashboard__ranges");
		const windowLine = document.querySelector("[data-test-admin-dashboard-window]");
		const widgets = Array.from(document.querySelectorAll("[data-test-admin-dashboard-widget]"));
		const button = document.querySelector("[data-test-admin-dashboard-empty-action]");
		assert(nav, "the range strip renders");
		assert(button, "an empty widget offers a longer range");
		const targets = inFlightTargets({ document, button });
		assert.deepEqual(targets, [button.closest("form"), windowLine, ...widgets]);
		assert.equal(targets.includes(nav), false);
	});

	it("keeps the in-flight marker to the dashboard and its strip", async () => {
		const harness = buildHarness({ logsInsights: initInMemoryLogsInsights() });
		const agent = await adminAgent(harness);

		const dashboard = new JSDOM((await agent.get("/admin/dashboards/hn-experiment")).text).window.document;
		const index = new JSDOM((await agent.get("/admin/dashboards")).text).window.document;

		assert.deepEqual(
			Array.from(dashboard.querySelectorAll("[hx-indicator]")).map((carrier) => [
				carrier.tagName,
				carrier.getAttribute("hx-indicator"),
			]),
			[
				["MAIN", "closest form, .admin-dashboard__window, .admin-dashboard__widget"],
				["NAV", "closest form, closest .admin-dashboard__ranges, .admin-dashboard__window, .admin-dashboard__widget"],
			],
		);
		assert.equal(index.querySelectorAll("[hx-indicator]").length, 0);
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

describe("GET /admin/dashboards/:slug repeated within one 10-minute step", () => {
	function clockAt(times: string[]) {
		const instants = times.map((time) => new Date(time));
		let index = 0;
		return {
			now: () => instants[Math.min(index, instants.length - 1)],
			advance: () => {
				index += 1;
			},
		};
	}

	it("answers a repeat view within the same 10 minutes without querying again", async () => {
		const widgets = DASHBOARDS["hn-experiment"].widgets(EXCLUDED);
		const logsInsights = initInMemoryLogsInsights();
		logsInsights.answerQuery({
			queryString: widgets[0].query,
			rows: [[{ field: "campaign_id", value: "hn-starter-2026-09" }]],
		});
		const clock = clockAt(["2026-10-18T06:03:00.000Z", "2026-10-18T06:08:00.000Z"]);
		let exclusionReads = 0;
		const harness = buildHarness({
			logsInsights,
			now: clock.now,
			readExcludedIdentities: async () => {
				exclusionReads += 1;
				return EXCLUDED;
			},
		});
		const agent = await adminAgent(harness);

		const first = await agent.get("/admin/dashboards/hn-experiment");
		clock.advance();
		const second = await agent.get("/admin/dashboards/hn-experiment");

		assert.deepEqual([first.status, second.status], [200, 200]);
		assert.deepEqual([first.headers["cache-control"], second.headers["cache-control"]], ["no-store", "no-store"]);
		assert.equal(logsInsights.runQueries.length, widgets.length);
		assert.deepEqual(
			[...new Set(logsInsights.runQueries.map((query) => query.endTime.toISOString()))],
			["2026-10-18T06:00:00.000Z"],
		);
		const firstDocument = new JSDOM(first.text).window.document;
		const secondDocument = new JSDOM(second.text).window.document;
		assert.deepEqual(readWidgets(secondDocument), readWidgets(firstDocument));
		assert.deepEqual(
			[firstDocument, secondDocument].map((document) => document.querySelector("[data-test-admin-dashboard-window]")?.textContent),
			["Oct 11, 2026, 06:00 UTC – Oct 18, 2026, 06:00 UTC", "Oct 11, 2026, 06:00 UTC – Oct 18, 2026, 06:00 UTC"],
		);
		assert.equal(exclusionReads, 1);
	});

	it("queries each range once", async () => {
		const widgets = DASHBOARDS["hn-experiment"].widgets(EXCLUDED);
		const logsInsights = initInMemoryLogsInsights();
		const harness = buildHarness({ logsInsights });
		const agent = await adminAgent(harness);

		await agent.get("/admin/dashboards/hn-experiment?range=7d");
		await agent.get("/admin/dashboards/hn-experiment?range=1d");
		const again = await agent.get("/admin/dashboards/hn-experiment?range=7d");

		assert.equal(logsInsights.runQueries.length, widgets.length * 2);
		const current = new JSDOM(again.text).window.document.querySelector('[data-test-admin-dashboard-range][aria-current="page"]');
		assert.equal(current?.getAttribute("data-test-admin-dashboard-range"), "7d");
	});

	it("keeps dashboards apart", async () => {
		const logsInsights = initInMemoryLogsInsights();
		const harness = buildHarness({ logsInsights });
		const agent = await adminAgent(harness);

		await agent.get("/admin/dashboards/hn-experiment");
		await agent.get("/admin/dashboards/mcp");

		assert.equal(
			logsInsights.runQueries.length,
			DASHBOARDS["hn-experiment"].widgets(EXCLUDED).length + DASHBOARDS.mcp.widgets(EXCLUDED).length,
		);
	});

	it("queries again after the 10-minute mark", async () => {
		const widgets = DASHBOARDS["hn-experiment"].widgets(EXCLUDED);
		const logsInsights = initInMemoryLogsInsights();
		const clock = clockAt(["2026-10-18T06:08:00.000Z", "2026-10-18T06:12:00.000Z"]);
		const harness = buildHarness({ logsInsights, now: clock.now });
		const agent = await adminAgent(harness);

		await agent.get("/admin/dashboards/hn-experiment");
		clock.advance();
		await agent.get("/admin/dashboards/hn-experiment");

		assert.equal(logsInsights.runQueries.length, widgets.length * 2);
		assert.deepEqual(
			[...new Set(logsInsights.runQueries.slice(widgets.length).map((query) => query.endTime.toISOString()))],
			["2026-10-18T06:10:00.000Z"],
		);
	});

	it("does not keep a failed view", async () => {
		const widgets = DASHBOARDS.mcp.widgets(EXCLUDED);
		const logsInsights = initInMemoryLogsInsights();
		let failuresLeft = 1;
		const harness = buildHarness({
			logsInsights,
			runLogsInsightsQuery: async (query, options) => {
				if (query.queryString === widgets[1].query && failuresLeft > 0) {
					failuresLeft -= 1;
					await logsInsights.runLogsInsightsQuery(query, options);
					throw new Error("Logs Insights query query-7 ended Timeout");
				}
				return logsInsights.runLogsInsightsQuery(query, options);
			},
		});
		const agent = await adminAgent(harness);

		const failed = await agent.get("/admin/dashboards/mcp");
		const retried = await agent.get("/admin/dashboards/mcp");

		assert.deepEqual([failed.status, retried.status], [500, 200]);
		assert.equal(logsInsights.runQueries.length, widgets.length * 2);
	});
});

describe("GET /admin/dashboards/:slug exclusion parameter reads", () => {
	it("reads the exclusion parameter once across two dashboard loads", async () => {
		const requested: GetParameterCommand[] = [];
		const readExcludedIdentities = initSsmExcludedIdentities({
			getParameter: async (command) => {
				requested.push(command);
				return { Parameter: { Value: JSON.stringify(EXCLUDED) } };
			},
			parameterName: EXCLUDED_IDENTITIES_PARAMETER_NAME,
			parseExcludedIdentities,
		});
		const logsInsights = initInMemoryLogsInsights();
		const harness = buildHarness({ logsInsights, readExcludedIdentities });
		const agent = await adminAgent(harness);

		const hnExperiment = await agent.get("/admin/dashboards/hn-experiment");
		const mcp = await agent.get("/admin/dashboards/mcp");

		assert.deepEqual([hnExperiment.status, mcp.status], [200, 200]);
		assert.deepEqual(requested.map((command) => command.input), [{ Name: "/readplace/excluded-identities" }]);
		const ranQueries = logsInsights.runQueries.map((query) => query.queryString);
		for (const slug of ["hn-experiment", "mcp"] as const) {
			for (const widget of DASHBOARDS[slug].widgets(EXCLUDED)) {
				assert.ok(ranQueries.includes(widget.query), `${slug} ran ${widget.title}`);
			}
		}
	});
});
