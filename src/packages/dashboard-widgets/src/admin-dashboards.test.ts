import assert from "node:assert/strict";
import { ADMIN_DASHBOARD_SLUGS, buildAdminDashboards } from "./admin-dashboards";
import { AUTH_DIAGNOSTICS_LOG_GROUP } from "./auth-diagnostics-widgets";
import { type ExcludedIdentities, excludeNonAudienceClauses } from "./excluded-identities";

const IDENTITIES: ExcludedIdentities = {
	excludedVisitorIds: ["11111111-1111-4111-8111-111111111111"],
	excludedUserIds: ["22222222222222222222222222222222"],
};

const EXCLUDE = excludeNonAudienceClauses(IDENTITIES).join(" ");

const dashboards = buildAdminDashboards();

const titles = (slug: (typeof ADMIN_DASHBOARD_SLUGS)[number]) =>
	dashboards[slug].widgets(IDENTITIES).map((widget) => widget.title);

describe("buildAdminDashboards", () => {
	it("builds one dashboard per slug", () => {
		assert.deepEqual(Object.keys(dashboards), [...ADMIN_DASHBOARD_SLUGS]);
	});

	it("marks every dashboard but login as using the audience exclusions", () => {
		assert.deepEqual(
			ADMIN_DASHBOARD_SLUGS.map((slug) => [slug, dashboards[slug].usesExclusions]),
			[
				["hn-experiment", true],
				["mcp", true],
				["login", false],
				["keep-engine", true],
			],
		);
	});

	it("carries the exclusions into a dashboard that uses them", () => {
		assert.ok(dashboards["keep-engine"].widgets(IDENTITIES).every((widget) => widget.query.includes(EXCLUDE)));
	});

	it("orders the Hacker News experiment widgets report first", () => {
		assert.equal(titles("hn-experiment").length, 6);
		assert.match(titles("hn-experiment")[0], /latest experiment report/);
	});

	it("orders the MCP widgets tool calls first and handshakes last", () => {
		const mcp = titles("mcp");
		assert.equal(mcp.length, 5);
		assert.match(mcp[0], /^MCP tool calls by client/);
		assert.match(mcp[4], /^MCP handshakes/);
	});

	it("puts the OAuth widgets before the five authentication diagnostics, which read their own group", () => {
		const login = dashboards.login.widgets(IDENTITIES);
		assert.equal(login.length, 7);
		assert.match(login[0].title, /^OAuth token grants/);
		assert.match(login[1].title, /^OAuth token revocations/);
		assert.ok(login.slice(2).every((widget) => widget.logGroupNames.includes(AUTH_DIAGNOSTICS_LOG_GROUP)));
	});

	it("lists the keep engine widgets from trials to charges", () => {
		const keep = titles("keep-engine");
		assert.equal(keep.length, 8);
	});
});
