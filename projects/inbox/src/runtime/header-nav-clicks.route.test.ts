import { CUSTOM_EMAILS_PATH, INBOX_PATH } from "@packages/domain/inbox";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import type { AnalyticsClick, AnalyticsEvent } from "@packages/web-analytics";
import { buildGuestNavGroups, buildNavGroups, withInternalTracking } from "@packages/web-shell";
import { BROWSER_USER_AGENT } from "@packages/web-test-harness";
import { loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();

const BROWSER_HEADERS: Record<string, string> = {
	"User-Agent": BROWSER_USER_AGENT,
	"Accept-Language": "en-US,en;q=0.9",
	"Sec-CH-UA": '"Chromium";v="145", "Google Chrome";v="145", "Not?A_Brand";v="24"',
	"Sec-Fetch-Mode": "navigate",
	"Sec-Fetch-Dest": "document",
};

const INBOX_ITEMS = [
	...buildGuestNavGroups(),
	...[false, true].flatMap((accessIsReadOnly) => buildNavGroups({ accessIsReadOnly })),
]
	.flatMap((group) => group.items)
	.filter((item) => new URL(item.href, TEST_APP_ORIGIN).pathname.startsWith(INBOX_PATH));

const LINKS_FROM_OTHER_SURFACES = [
	{ key: "onboarding see-inbox-address", source: "onboarding", content: "see-inbox-address" },
	{ key: "queue-preferences create-inbox", source: "queue-preferences", content: "create-inbox" },
].map((link) => ({ ...link, href: withInternalTracking(CUSTOM_EMAILS_PATH, link) }));

function clicksFor(events: AnalyticsEvent[], tag: { source: string; content: string }): AnalyticsClick[] {
	return events.filter(
		(event): event is AnalyticsClick =>
			event.event === "click" && event.utm_source === tag.source && event.utm_content === tag.content,
	);
}

async function followThroughInboxApp(href: string) {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const agent = await loginAgent(harness.server, harness.auth);
	const url = new URL(href, TEST_APP_ORIGIN);
	const response = await agent.get(`${url.pathname}${url.search}`).set(BROWSER_HEADERS);
	return { status: response.status, events: harness.analytics.events };
}

describe("every header nav destination the inbox app serves records the click its tag promises", () => {
	it("finds the inbox destination in the nav", () => {
		expect(INBOX_ITEMS.map((item) => item.key)).toContain("inbox");
	});

	it.each(INBOX_ITEMS.map((item) => [item.key, item] as const))("records one click for the %s item", async (_key, item) => {
		const followed = await followThroughInboxApp(item.href);

		expect(followed.status).toBe(200);
		expect(clicksFor(followed.events, { source: item.trackSource, content: item.trackContent })).toHaveLength(1);
	});
});

describe("every inbox CTA another surface renders records the click its tag promises", () => {
	it.each(LINKS_FROM_OTHER_SURFACES.map((link) => [link.key, link] as const))(
		"records one click for the %s link",
		async (_key, link) => {
			const followed = await followThroughInboxApp(link.href);

			expect(followed.status).toBe(200);
			expect(clicksFor(followed.events, link)).toHaveLength(1);
		},
	);
});
