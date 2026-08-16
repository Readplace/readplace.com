import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("GET /help/add-links", () => {
	it("renders the Share instructions as HTML for a logged-out visitor", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-help-title]")?.textContent).toBe(
			"Add links with Share",
		);
		const steps = Array.from(
			doc.querySelectorAll("[data-test-help-step]"),
		).map((el) => el.textContent?.trim());
		expect(steps).toEqual([
			"Open a link in any app.",
			"Tap Share.",
			"Choose Readplace.",
		]);
		expect(doc.querySelector("[data-test-help-note]")?.textContent).toContain(
			"captures the full page",
		);
	});

	it("teaches pinning Readplace to the share row with the share recording", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-help-pin-title]")?.textContent).toBe(
			"Pin Readplace to the share row",
		);

		const video = doc.querySelector("[data-test-help-video]");
		assert(video, "the pin section must render the share recording");
		expect(
			Array.from(video.querySelectorAll("source")).map((el) => [
				el.getAttribute("src"),
				el.getAttribute("type"),
			]),
		).toEqual([["https://static.test/videos/ios-share-demo-h264.mp4", "video/mp4"]]);
		expect(video.getAttribute("poster")).toBe(
			"https://static.test/videos/ios-share-demo-poster.webp",
		);
		expect(video.getAttribute("aria-label")).toBe(
			"Saving a page to Readplace from the iOS share sheet, and moving Readplace to the front of the share row",
		);
	});

	it("reserves the recording's box and leaves playback to the reader", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		const video = doc.querySelector("[data-test-help-video]");
		assert(video, "the pin section must render the share recording");
		expect([video.getAttribute("width"), video.getAttribute("height")]).toEqual(["540", "1174"]);
		expect(video.hasAttribute("controls")).toBe(true);
		expect(video.hasAttribute("playsinline")).toBe(true);
		expect(video.hasAttribute("muted")).toBe(true);
		// Nothing starts on its own: that keeps the page out of WCAG 2.2.2 scope,
		// needs no reduced-motion escape hatch, and leaves the file off the load.
		expect(video.hasAttribute("autoplay")).toBe(false);
		expect(video.hasAttribute("loop")).toBe(false);
		expect(video.getAttribute("preload")).toBe("none");
	});

	it("spells the pin procedure out in text, since the recording is silent", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		const steps = Array.from(doc.querySelectorAll("[data-test-help-pin-step]")).map(
			(el) => el.textContent?.trim(),
		);
		expect(steps).toEqual([
			"Tap Share, then scroll the app row right and tap More.",
			"Tap Edit.",
			"Tap the + beside Readplace, then Done.",
		]);
	});

	it("renders a Back to queue deep link when hosted in the app web sheet", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links?shell=app");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const back = doc.querySelector("[data-test-help-back-link]");
		expect(back?.getAttribute("href")).toBe("readplace://reader/close");
		expect(back?.textContent?.trim()).toBe("Back to queue");
		// The chromeless variant hard-codes the home-indicator pad the app sheet needs.
		expect(doc.querySelector("main")?.className).toBe("help help--app");
	});

	it("omits the deep link for an ordinary browser visitor", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-help-back-link]")).toBeNull();
		expect(doc.querySelector("main")?.className).toBe("help");
	});

	it("carries a CSP nonce on its stylesheet — the page builds its own document, so the shell never nonces it", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		const nonces = Array.from(doc.querySelectorAll("style")).map((el) =>
			el.getAttribute("nonce"),
		);
		expect(nonces).toEqual([expect.stringMatching(/^[A-Za-z0-9_-]{22}$/)]);
	});

	it("falls through to HTML when text/markdown is requested", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server)
			.get("/help/add-links")
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});
});
