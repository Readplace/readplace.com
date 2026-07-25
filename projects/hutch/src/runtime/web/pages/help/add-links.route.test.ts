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

	it("renders the three iPhone screenshots from the static base url, in order", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		const shots = Array.from(
			doc.querySelectorAll("[data-test-help-slide] .help__shot-img"),
		);
		expect(shots.map((el) => el.getAttribute("src"))).toEqual([
			"https://static.test/screenshots/ios-share-sheet.webp",
			"https://static.test/screenshots/ios-reading-list.webp",
			"https://static.test/screenshots/ios-reader.webp",
			"https://static.test/screenshots/ios-share-sheet.webp",
		]);
		expect(shots.map((el) => el.getAttribute("width"))).toEqual([
			"520",
			"520",
			"520",
			"520",
		]);
	});

	it("captions each screenshot with the Share instruction it illustrates", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		const captions = Array.from(
			doc.querySelectorAll("[data-test-help-slide] .help__shot-caption"),
		).map((el) => el.textContent?.trim());
		expect(captions).toEqual([
			"Tap Share, then choose Readplace.",
			"Saved links land in your queue.",
			"Read them later, clean — with a TL;DR.",
			"Tap Share, then choose Readplace.",
		]);
	});

	it("hides the wrap-around clone of the first screenshot from assistive tech", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		const slides = Array.from(doc.querySelectorAll("[data-test-help-slide]"));
		expect(
			slides.map((el) => el.getAttribute("aria-hidden") ?? "exposed"),
		).toEqual(["exposed", "exposed", "exposed", "true"]);

		const clone = slides[slides.length - 1];
		expect(clone?.className).toContain("help__slide--loop");
		expect(clone?.querySelector(".help__shot-img")?.getAttribute("alt")).toBe("");
	});

	it("names the carousel region for assistive tech", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		const viewport = doc.querySelector("[data-test-help-viewport]");
		expect(viewport?.getAttribute("aria-label")).toBe("Readplace screenshots");
	});

	it("walks through pinning Readplace to the share row, in order", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-help-pin-title]")?.textContent).toBe(
			"Pin Readplace to the share row",
		);

		const steps = Array.from(doc.querySelectorAll("[data-test-help-pin-step]"));
		expect(steps.map((el) => el.querySelector("img")?.getAttribute("src"))).toEqual([
			"https://static.test/screenshots/ios-share-more.webp",
			"https://static.test/screenshots/ios-share-favourite.webp",
			"https://static.test/screenshots/ios-share-pinned.webp",
		]);
		expect(
			steps.map((el) => el.querySelector("figcaption")?.textContent?.trim()),
		).toEqual([
			"Tap Share, scroll the row right, then tap More.",
			"Tap Edit, then add Readplace to your Favourites.",
			"Readplace now sits first — no scrolling, no hunting.",
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

	it("falls through to HTML when text/markdown is requested", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server)
			.get("/help/add-links")
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});
});
