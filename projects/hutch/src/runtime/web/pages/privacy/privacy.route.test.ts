import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const useApp = useTestServer();

describe("GET /privacy", () => {
	it("should return 200 and HTML content", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("returns markdown when Accept: text/markdown is sent", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server)
			.get("/privacy")
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text).toMatch(/^# /);
	});

	it("tells a reader what a connected AI assistant can do with their readlist and how to cut it off", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("Connected AI assistants");
		expect(response.text).toContain("It cannot delete anything");
		expect(response.text).toContain("Sign an assistant out under");
		expect(response.text).toContain("on your Account page");
		expect(response.text).toContain("revokes its Readplace token");
		expect(response.text).toContain("list your readlists, create a readlist and add a saved article to one");
		expect(response.text).toContain("Changing or resetting your password, or deleting your Readplace account, revokes every connected assistant at once.");
		const doc = new JSDOM(response.text).window.document;
		expect(Array.from(doc.querySelectorAll('.legal-page__section a[href^="/account"]')).map((link) => link.getAttribute("href"))).toEqual([
			"/account?utm_source=privacy&utm_medium=internal&utm_content=account-assistants#connected-apps",
			"/account?utm_source=privacy&utm_medium=internal&utm_content=account-rights",
		]);
	});

	it("lists what a connected app's sign-in records and where the reader sees it", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		const doc = new JSDOM(response.text).window.document;
		const items = Array.from(doc.querySelectorAll(".legal-page__list li"), (item) => item.textContent);
		expect(items.filter((text) => text?.startsWith("Connected app sign-ins:"))).toEqual([
			"Connected app sign-ins: when you connect an app or an AI assistant, Readplace records the time you approved it, the browser and operating system you approved it from, and the city and country your network address pointed to at that moment. These show under Connected apps on your Account page and are deleted when that sign-in ends.",
		]);
	});

	it("names the homepage experiment cookie among the first-party cookies", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("which version of the homepage you were shown during a test (1 year)");
	});

	it("carries the date of its latest change", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("Last updated: 19 October 2026");
	});

	it("lists the optional display name among the account information Readplace keeps", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("the name you add on your Account page");
	});

	it("scopes the account-deletion claim to the saved list and reading history, not 'every saved article'", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("along with your saved list and your reading history");
	});

	it("tells a disconnecting reader the forwarding address is theirs to remove", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("asks Google to remove the Readplace filter");
		expect(response.text).toContain("remove it yourself under Forwarding and POP/IMAP");
	});
});
