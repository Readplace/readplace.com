import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { APPLE_ITUNES_APP_META } from "@packages/supported-clients";

const useApp = useTestServer();

/**
 * 1. Acquisition surfaces: a guest here has no app yet, so Safari's native
 *    install strip is the point.
 * 2. Sign-in surfaces: the iOS app runs /oauth/authorize inside an
 *    ASWebAuthenticationSession, so an "Open in app" strip here would push a
 *    user who is already in the app out to a browser mid sign-in — the hand-off
 *    App Store review rejected under Guideline 4.
 */
const SURFACES = [
	"/", /* 1 */
	"/install",
	"/pocket-alternative",
	"/login", /* 2 */
	"/signup",
	"/oauth/authorize",
];

const OFFERS_THE_BANNER = ["/", "/install", "/pocket-alternative"];

describe("Safari Smart App Banner", () => {
	it("is offered on the acquisition surfaces and on no sign-in surface", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const offering: string[] = [];
		for (const path of SURFACES) {
			const response = await request(harness.server).get(path);
			const doc = new JSDOM(response.text).window.document;
			const meta = doc.querySelector('meta[name="apple-itunes-app"]');
			if (meta) {
				expect(meta.getAttribute("content")).toBe(APPLE_ITUNES_APP_META);
				offering.push(path);
			}
		}

		expect(offering).toEqual(OFFERS_THE_BANNER);
	});
});
