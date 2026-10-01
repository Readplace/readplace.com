import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import type { AnalyticsClick, AnalyticsEvent, AnalyticsPageview } from "@packages/web-analytics";
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

function clicks(events: AnalyticsEvent[]): AnalyticsClick[] {
	return events.filter((e): e is AnalyticsClick => e.event === "click");
}

function pageviews(events: AnalyticsEvent[]): AnalyticsPageview[] {
	return events.filter((e): e is AnalyticsPageview => e.event === "pageview");
}

describe("inbox analytics instrumentation", () => {
	it("records a tagged internal link to /inbox as one click carrying its source and content", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/inbox?utm_source=header-nav&utm_medium=internal&utm_content=inbox")
			.set(BROWSER_HEADERS);

		expect(response.status).toBe(200);
		expect(clicks(harness.analytics.events)).toHaveLength(1);
		expect(clicks(harness.analytics.events)[0]).toMatchObject({
			utm_source: "header-nav",
			utm_medium: "internal",
			utm_content: "inbox",
		});
		expect(pageviews(harness.analytics.events)).toHaveLength(1);
		expect(pageviews(harness.analytics.events)[0].utm_source).toBeUndefined();
	});

	it("400s a utm value carrying an apostrophe and records nothing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/inbox?utm_source='").set(BROWSER_HEADERS);

		expect(response.status).toBe(400);
		expect(harness.analytics.events).toHaveLength(0);
	});
});
