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

	return [defaultGroup, sitemaps].join("\n\n");
}
