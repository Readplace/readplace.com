import request from "supertest";
import { INBOX_PATH } from "@packages/domain/inbox";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import type { AnalyticsClick, AnalyticsEvent } from "@packages/web-analytics";
import { type NavItem, buildGuestNavGroups, buildNavGroups } from "@packages/web-shell";
import { BROWSER_REQUEST_HEADERS, loginAgent, useTestServer } from "./test-app";

const useApp = useTestServer();

const SERVED_BY_OTHER_APPS = [INBOX_PATH, "/blog"];

function servedByHutch(item: NavItem): boolean {
	const { pathname } = new URL(item.href, TEST_APP_ORIGIN);
	return !SERVED_BY_OTHER_APPS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function uniqueByKey(items: NavItem[]): NavItem[] {
	return [...new Map(items.map((item) => [item.key, item])).values()];
}

const GUEST_ITEMS = uniqueByKey(buildGuestNavGroups().flatMap((group) => group.items));
const MEMBER_ITEMS = uniqueByKey(
	[false, true].flatMap((accessIsReadOnly) =>
		[false, true].flatMap((gmailFeatureEnabled) =>
			buildNavGroups({ accessIsReadOnly, gmailFeatureEnabled }).flatMap((group) => group.items),
		),
	),
);

function requestTarget(item: NavItem): string {
	const url = new URL(item.href, TEST_APP_ORIGIN);
	return `${url.pathname}${url.search}`;
}

function clicksFor(events: AnalyticsEvent[], item: NavItem): AnalyticsClick[] {
	return events.filter(
		(event): event is AnalyticsClick =>
			event.event === "click" && event.utm_source === item.trackSource && event.utm_content === item.trackContent,
	);
}

describe("every header nav destination hutch serves records the click its tag promises", () => {
	it("hands the inbox and blog destinations to the apps that serve them, so their own tests follow those", () => {
		const elsewhere = [...GUEST_ITEMS, ...MEMBER_ITEMS].filter((item) => !servedByHutch(item));

		expect(uniqueByKey(elsewhere).map((item) => item.key).sort()).toEqual(["blog", "inbox"]);
	});

	it.each(GUEST_ITEMS.filter(servedByHutch).map((item) => [item.key, item] as const))(
		"records one click for the guest %s item",
		async (_key, item) => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = request(harness.server);

			const response = await (item.method === "POST" ? agent.post(requestTarget(item)) : agent.get(requestTarget(item)))
				.set(BROWSER_REQUEST_HEADERS)
				.redirects(5);

			expect(response.status).toBeLessThan(400);
			expect(clicksFor(harness.analytics.events, item)).toHaveLength(1);
		},
	);

	it.each(MEMBER_ITEMS.filter(servedByHutch).map((item) => [item.key, item] as const))(
		"records one click for the signed-in %s item",
		async (_key, item) => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await (item.method === "POST" ? agent.post(requestTarget(item)) : agent.get(requestTarget(item)))
				.set(BROWSER_REQUEST_HEADERS)
				.redirects(5);

			expect(response.status).toBeLessThan(400);
			expect(clicksFor(harness.analytics.events, item)).toHaveLength(1);
		},
	);
});
