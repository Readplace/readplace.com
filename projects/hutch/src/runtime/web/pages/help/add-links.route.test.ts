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

	it("teaches the iOS share row to a browser visitor, who names no platform", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-help-pin-title]")?.textContent).toBe(
			"Pin Readplace to the share row",
		);
		expect(doc.querySelector("[data-test-help-pin-lead]")?.textContent).toBe(
			"iOS buries new apps at the end of the share row. Favourite Readplace once and it moves to the front.",
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
			"Saving a page to Readplace from the iOS share sheet, and the article arriving at the top of the reading list",
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

	it("teaches the Android share sheet's own pin action when the app sheet names android", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get(
			"/help/add-links?shell=app&platform=android",
		);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-help-pin-title]")?.textContent).toBe(
			"Pin Readplace in the share sheet",
		);
		expect(doc.querySelector("[data-test-help-pin-lead]")?.textContent).toBe(
			"Android sorts the share sheet by what you share to most. Pin Readplace once and it leads the app list.",
		);
		const steps = Array.from(
			doc.querySelectorAll("[data-test-help-pin-step]"),
		).map((el) => el.textContent?.trim());
		expect(steps).toEqual([
			"Tap Share, then find Readplace in the app list.",
			"Press and hold Readplace.",
			"Tap Pin Readplace.",
		]);
	});

	it("pairs the Android sheet with the Android capture, not the iPhone one", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get(
			"/help/add-links?shell=app&platform=android",
		);

		const doc = new JSDOM(response.text).window.document;
		const video = doc.querySelector("[data-test-help-video]");
		assert(video, "the pin section must render the Android share recording");
		expect(
			Array.from(video.querySelectorAll("source")).map((el) => [
				el.getAttribute("src"),
				el.getAttribute("type"),
			]),
		).toEqual([
			["https://static.test/videos/android-share-demo-h264.mp4", "video/mp4"],
		]);
		expect(video.getAttribute("poster")).toBe(
			"https://static.test/videos/android-share-demo-poster.webp",
		);
		const recordings = Array.from(doc.querySelectorAll("video")).map((el) =>
			el.getAttribute("aria-label"),
		);
		expect(recordings).toEqual([
			"Saving a page to Readplace from the Android share sheet, and pinning Readplace to the front of the app list",
		]);
	});

	it("reserves the Android recording's own box, which is a taller capture than the iPhone's", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get(
			"/help/add-links?shell=app&platform=android",
		);

		const doc = new JSDOM(response.text).window.document;
		const video = doc.querySelector("[data-test-help-video]");
		assert(video, "the pin section must render the Android share recording");
		expect([video.getAttribute("width"), video.getAttribute("height")]).toEqual([
			"540",
			"1212",
		]);
		expect(video.getAttribute("preload")).toBe("none");
		expect(video.hasAttribute("autoplay")).toBe(false);
	});

	it("keeps the share-row section and its recording for the shipped iOS sheet, which sends ?shell=app and names no platform", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links?shell=app");

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-help-pin-title]")?.textContent).toBe(
			"Pin Readplace to the share row",
		);
		expect(doc.querySelector("[data-test-help-pin-lead]")?.textContent).toBe(
			"iOS buries new apps at the end of the share row. Favourite Readplace once and it moves to the front.",
		);
		const steps = Array.from(
			doc.querySelectorAll("[data-test-help-pin-step]"),
		).map((el) => el.textContent?.trim());
		expect(steps).toEqual([
			"Tap Share, then scroll the app row right and tap More.",
			"Tap Edit.",
			"Tap the + beside Readplace, then Done.",
		]);
		const recordings = Array.from(doc.querySelectorAll("video")).map((el) =>
			el.getAttribute("aria-label"),
		);
		expect(recordings).toEqual([
			"Saving a page to Readplace from the iOS share sheet, and the article arriving at the top of the reading list",
		]);
	});

	it("keeps the share-row section and its recording when a sheet names ios outright", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get(
			"/help/add-links?shell=app&platform=ios",
		);

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-help-pin-title]")?.textContent).toBe(
			"Pin Readplace to the share row",
		);
		const steps = Array.from(
			doc.querySelectorAll("[data-test-help-pin-step]"),
		).map((el) => el.textContent?.trim());
		expect(steps).toEqual([
			"Tap Share, then scroll the app row right and tap More.",
			"Tap Edit.",
			"Tap the + beside Readplace, then Done.",
		]);
		const recordings = Array.from(doc.querySelectorAll("video")).map((el) =>
			el.getAttribute("aria-label"),
		);
		expect(recordings).toEqual([
			"Saving a page to Readplace from the iOS share sheet, and the article arriving at the top of the reading list",
		]);
	});

	it("renders a Back to readlist deep link when hosted in the app web sheet", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links?shell=app");

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const back = doc.querySelector("[data-test-help-back-link]");
		expect(back?.getAttribute("href")).toBe("readplace://reader/close");
		expect(back?.textContent?.trim()).toBe("Back to readlist");
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
