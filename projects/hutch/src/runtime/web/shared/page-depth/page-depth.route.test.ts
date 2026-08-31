import request from "supertest";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

const PATH = "/page-depth/event";

function depthQuery(overrides: Record<string, string> = {}): string {
	const params = new URLSearchParams({
		deepest: "1200",
		height: "4000",
		viewport: "800",
		exit: "left_site",
		...overrides,
	});
	return `${PATH}?${params.toString()}`;
}

describe("POST /page-depth/event", () => {
	it("records how much of the page never came into view", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post(depthQuery())
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(204);
		expect(harness.analytics.events).toContainEqual(
			expect.objectContaining({
				event: "page_depth",
				path: "/",
				deepest_px: 1200,
				page_height_px: 4000,
				viewport_height_px: 800,
				unseen_px: 2800,
				seen_percent: 30,
				exit_kind: "left_site",
			}),
		);
	});

	it("separates a reader who clicked onward from one who left the site", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		await request(harness.server)
			.post(depthQuery({ exit: "navigated_onward" }))
			.set(BROWSER_REQUEST_HEADERS);

		expect(harness.analytics.events).toContainEqual(
			expect.objectContaining({ event: "page_depth", exit_kind: "navigated_onward" }),
		);
	});

	it("treats a page shorter than the viewport as fully seen rather than more than fully seen", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		await request(harness.server)
			.post(depthQuery({ deepest: "900", height: "600" }))
			.set(BROWSER_REQUEST_HEADERS);

		expect(harness.analytics.events).toContainEqual(
			expect.objectContaining({
				event: "page_depth",
				deepest_px: 600,
				unseen_px: 0,
				seen_percent: 100,
			}),
		);
	});

	it("answers 204 and records nothing when the report is malformed, because the reader has already gone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post(depthQuery({ deepest: "not-a-number" }))
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(204);
		expect(harness.analytics.events).toEqual([]);
	});

	it("refuses an exit kind it does not know, rather than inventing a bucket", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post(depthQuery({ exit: "teleported" }))
			.set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(204);
		expect(harness.analytics.events).toEqual([]);
	});

	it("refuses a pixel count no real page could produce", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		await request(harness.server)
			.post(depthQuery({ height: "99999999" }))
			.set(BROWSER_REQUEST_HEADERS);

		expect(harness.analytics.events).toEqual([]);
	});
});
