import assert from "node:assert/strict";
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
			"/account?utm_source=privacy&utm_medium=internal&utm_content=account-delete",
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

	it("covers the iOS and Android apps and what they send", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("the website, the browser extensions, and the iOS and Android apps");
		expect(response.text).toContain("the app also sends the page as your device showed it");
		expect(response.text).toContain("keep a random id for each installation");
		expect(response.text).toContain("app sign-in diagnostics for a year");
	});

	it("lists the account-deletion steps publicly under a linkable anchor", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		const doc = new JSDOM(response.text).window.document;
		const section = doc.getElementById("delete-account");
		assert(section, "the deletion section must carry the delete-account anchor");
		expect(Array.from(section.querySelectorAll("ol li"), (item) => item.textContent)).toEqual([
			"Sign in and open your Account page. In the app, open Account.",
			"Under Danger zone, choose Delete account.",
			"Type delete my account permanently and confirm.",
		]);
		expect(section.textContent).toContain("unless another reader has saved the same page");
	});

	it("names the homepage experiment cookie among the first-party cookies", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("which version of the homepage you were shown during a test (1 year)");
	});

	it("says what newsletters send to an AI provider", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		const doc = new JSDOM(response.text).window.document;
		const items = Array.from(doc.querySelectorAll(".legal-page__item-text"), (item) => item.textContent);
		expect(items.some((text) => text?.endsWith("For newsletters, each issue's subject, sender, link addresses and link text are sent to an AI provider to tell articles from ads and menus, and, for a readlist you described, what you wrote and the articles you kept in it or took out of it are sent with them to choose which fit."))).toBe(true);
	});

	it("carries the date of its latest change", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("Last updated: 7 November 2026");
	});

	it("lists a file uploaded before signing up among the data Readplace collects", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		const doc = new JSDOM(response.text).window.document;
		const items = Array.from(doc.querySelectorAll("li"), (item) => item.textContent);
		expect(items).toContain("Files uploaded before signing up: the file, its name, and the title, authors and chapter titles read from it.");
	});

	it("says how long a file uploaded before signing up is kept", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("A file you upload before signing up, with its name, title, authors and chapter titles, is deleted within a few days. Until you save it no account holds them, so you cannot delete them sooner. If you save it to your queue, the book stays with your saved articles until you remove it.");
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

	it("says what the Gmail read and modify permissions are used for", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("Import unread messages asks for permission to read your email");
		expect(response.text).toContain("Marking imported emails as read asks for permission to modify your email");
		expect(response.text).toContain("Readplace never sends or deletes your email.");
	});

	it("commits Gmail data to Google's Limited Use requirements", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		const doc = new JSDOM(response.text).window.document;
		const links = Array.from(doc.querySelectorAll("a"), (link) => ({ text: link.textContent, href: link.getAttribute("href") }));
		expect(links).toContainEqual({
			text: "Google API Services User Data Policy",
			href: "https://developers.google.com/terms/api-services-user-data-policy",
		});
		expect(response.text).toContain("including the Limited Use requirements");
		expect(response.text).toContain("does not use it to train AI models");
	});
});
