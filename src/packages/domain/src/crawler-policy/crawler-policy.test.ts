import assert from "node:assert/strict";
import { AI_CRAWLER_AGENTS, buildMediaRobotsTxt } from "./crawler-policy";

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

describe("AI_CRAWLER_AGENTS", () => {
	it("pins the exact agent set blocked from article copies", () => {
		expect(AI_CRAWLER_AGENTS).toEqual([
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
		]);
	});
});

describe("buildMediaRobotsTxt", () => {
	const robotsTxt = buildMediaRobotsTxt();

	it("allows unfurl bots and search engines to fetch card imagery", () => {
		expect(groupFor({ robotsTxt, agent: "*" })).toEqual(["User-agent: *", "Allow: /"]);
	});

	it.each([...AI_CRAWLER_AGENTS])("blocks %s from the whole media host", (agent) => {
		expect(groupFor({ robotsTxt, agent })).toEqual([`User-agent: ${agent}`, "Disallow: /"]);
	});

	it("contains no other groups", () => {
		expect(groupsOf(robotsTxt)).toHaveLength(1 + AI_CRAWLER_AGENTS.length);
	});
});
