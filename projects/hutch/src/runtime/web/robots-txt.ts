import { AI_CRAWLER_AGENTS } from "@packages/domain/crawler-policy";
import { QUEUE_PATH } from "./pages/queue/queue.url";

const ROBOTS_CONTENT_SIGNAL = "search=yes, ai-input=yes";

const QUEUE_PERMALINK_ALLOWS = [
	`Allow: ${QUEUE_PATH}/*/view$`,
	`Allow: ${QUEUE_PATH}/*/view?`,
	`Allow: ${QUEUE_PATH}/*/read$`,
	`Allow: ${QUEUE_PATH}/*/read?`,
];

const SHARED_DISALLOWS = [
	`Disallow: ${QUEUE_PATH}`,
	"Disallow: /export",
	"Disallow: /oauth",
	"Disallow: /forgot-password",
];

function aiCrawlerGroup(agent: string): string {
	return [
		`User-agent: ${agent}`,
		`Content-Signal: ${ROBOTS_CONTENT_SIGNAL}`,
		"Allow: /",
		"Disallow: /view",
		...SHARED_DISALLOWS,
	].join("\n");
}

export function buildRobotsTxt(baseUrl: string): string {
	const defaultGroup = [
		"User-agent: *",
		`Content-Signal: ${ROBOTS_CONTENT_SIGNAL}`,
		"Allow: /",
		...QUEUE_PERMALINK_ALLOWS,
		...SHARED_DISALLOWS,
	].join("\n");

	const sitemaps = [
		`Sitemap: ${baseUrl}/sitemap.xml`,
		`Sitemap: ${baseUrl}/blog/sitemap.xml`,
	].join("\n");

	return [defaultGroup, ...AI_CRAWLER_AGENTS.map(aiCrawlerGroup), sitemaps].join("\n\n");
}
