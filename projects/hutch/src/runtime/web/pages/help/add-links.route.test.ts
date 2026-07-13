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
			"https://static.test/screenshots/ios-share-sheet.png",
			"https://static.test/screenshots/ios-reading-list.png",
			"https://static.test/screenshots/ios-reader.png",
			"https://static.test/screenshots/ios-share-sheet.png",
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

	it("lets keyboard and assistive tech reach the carousel to stop it moving", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		const viewport = doc.querySelector("[data-test-help-viewport]");
		expect(viewport?.getAttribute("tabindex")).toBe("0");
		expect(viewport?.getAttribute("aria-label")).toBe("Readplace screenshots");
	});

	it("tells the reader the screenshots pause on hold", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(server).get("/help/add-links");

		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelector("[data-test-help-hint]")?.textContent).toBe(
			"Hold a screenshot to pause.",
		);
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
