export const AI_CRAWLER_AGENTS = [
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
] as const;

export function buildMediaRobotsTxt(): string {
	const defaultGroup = ["User-agent: *", "Allow: /"].join("\n");
	const aiGroups = AI_CRAWLER_AGENTS.map((agent) =>
		[`User-agent: ${agent}`, "Disallow: /"].join("\n"),
	);
	return [defaultGroup, ...aiGroups].join("\n\n");
}
