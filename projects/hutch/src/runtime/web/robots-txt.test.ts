import assert from "node:assert/strict";
import { buildRobotsTxt } from "./robots-txt";

const EXPECTED_AI_AGENTS = [
	"GPTBot",
	"OAI-SearchBot",
	"ChatGPT-User",
	"ClaudeBot",
	"Claude-SearchBot",
	"Claude-User",
	"PerplexityBot",
	"Perplexity-User",
	"CCBot",
	"Google-Extended",
	"Applebot-Extended",
	"Meta-ExternalAgent",
	"Amazonbot",
	"Bytespider",
];

const SHARED_DISALLOWS = [
	"Disallow: /queue",
	"Disallow: /export",
	"Disallow: /oauth",
	"Disallow: /forgot-password",
];

function groupsOf(robotsTxt: string): string[][] {
	return robotsTxt.split("\n\n").map((group) => group.split("\n"));
}

function groupFor(params: { robotsTxt: string; agent: string }): string[] {
	const group = groupsOf(params.robotsTxt).find(
		(lines) => lines[0] === `User-agent: ${params.agent}`,
	);
	assert(group, `robots.txt must contain a group for ${params.agent}`);
	return group;
}

describe("buildRobotsTxt", () => {
	const robotsTxt = buildRobotsTxt("https://readplace.com");

	it("keeps /view crawlable for search engines so they can see its noindex", () => {
		const defaultGroup = groupFor({ robotsTxt, agent: "*" });
		expect(defaultGroup).not.toContain("Disallow: /view");
		expect(defaultGroup).toContain("Allow: /");
	});

	it("opens the shared queue permalinks so crawlers can follow the redirect to /view's noindex", () => {
		const defaultGroup = groupFor({ robotsTxt, agent: "*" });
		expect(defaultGroup).toContain("Allow: /queue/*/view$");
		expect(defaultGroup).toContain("Allow: /queue/*/view?");
		expect(defaultGroup).toContain("Allow: /queue/*/read$");
		expect(defaultGroup).toContain("Allow: /queue/*/read?");
	});

	it("anchors the permalink allows so the auth-gated /queue/:id/reader fragment stays disallowed", () => {
		const defaultGroup = groupFor({ robotsTxt, agent: "*" });
		expect(defaultGroup).not.toContain("Allow: /queue/*/view");
		expect(defaultGroup).not.toContain("Allow: /queue/*/read");
	});

	it("keeps the private surfaces disallowed for every crawler", () => {
		const defaultGroup = groupFor({ robotsTxt, agent: "*" });
		for (const disallow of SHARED_DISALLOWS) {
			expect(defaultGroup).toContain(disallow);
		}
	});

	it("never disallows /save — /view links it with follow, so a robots block would invite URL-only indexing", () => {
		expect(robotsTxt).not.toContain("Disallow: /save");
	});

	it("declares only the origin-wide signals, leaving ai-train to per-path headers (blog opts in, app opts out)", () => {
		const defaultGroup = groupFor({ robotsTxt, agent: "*" });
		expect(defaultGroup).toContain("Content-Signal: search=yes, ai-input=yes");
		expect(robotsTxt).not.toContain("ai-train");
	});

	it.each(EXPECTED_AI_AGENTS)(
		"blocks %s from /view and restates every shared rule (named groups replace *)",
		(agent) => {
			const group = groupFor({ robotsTxt, agent });
			expect(group).toContain("Disallow: /view");
			expect(group).toContain("Allow: /");
			expect(group).toContain("Content-Signal: search=yes, ai-input=yes");
			for (const disallow of SHARED_DISALLOWS) {
				expect(group).toContain(disallow);
			}
		},
	);

	it("has no Googlebot group so Googlebot falls back to the default rules", () => {
		const agents = groupsOf(robotsTxt).map((lines) => lines[0]);
		expect(agents).not.toContain("User-agent: Googlebot");
	});

	it("never disallows the blog", () => {
		expect(robotsTxt).not.toContain("Disallow: /blog");
	});

	it("ends with both sitemap locations", () => {
		const groups = groupsOf(robotsTxt);
		expect(groups[groups.length - 1]).toEqual([
			"Sitemap: https://readplace.com/sitemap.xml",
			"Sitemap: https://readplace.com/blog/sitemap.xml",
		]);
	});

	it("pins the exact AI agent set", () => {
		const agents = groupsOf(robotsTxt)
			.map((lines) => String(lines[0]).replace("User-agent: ", ""))
			.filter((agent) => agent !== "*" && !agent.startsWith("Sitemap"));
		expect(agents).toEqual(EXPECTED_AI_AGENTS);
	});
});
