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

		expect(response.text).toContain("Last updated: 13 November 2026");
	});

	it("lists a file uploaded before signing up among the data Readplace collects", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		const doc = new JSDOM(response.text).window.document;
		const items = Array.from(doc.querySelectorAll("li"), (item) => item.textContent);
		expect(items).toContain("Files uploaded before signing up: the file, its name and size, and what Readplace reads from it: a book's title, authors and chapter titles, or an audio file's length.");
	});

	it("says what records the Gmail import and mark-as-read options keep, and how long the original copies stay", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("Import unread messages and Marking imported emails as read each keep records of their work: your Gmail address, each sender's address, the Readplace addresses the messages are delivered to, the dates an import covers, when you turned marking on, identifiers of the messages, where each run stopped, and what happened to each message and when. Import unread messages also stores the original copy of each message it downloads and deletes that copy within 31 days, whether or not Gmail stays connected.");
	});

	it("says disconnecting Gmail deletes the import and mark-as-read records", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("Disconnecting Gmail asks Google to remove the Readplace filter, revokes Readplace's access to your account and deletes the stored credentials, the discovered sender list, the six-hourly check's records and the import and mark-as-read records.");
	});

	it("says imported messages stay in the inbox after a disconnect and where to disconnect", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		const doc = new JSDOM(response.text).window.document;
		const paragraphs = Array.from(doc.querySelectorAll(".legal-page__section p"), (paragraph) => paragraph.textContent);
		expect(paragraphs.some((text) => text?.includes("Messages already imported or forwarded stay in your Readplace inbox after you disconnect, until you delete your account. To disconnect, open the From Gmail page and press Disconnect Gmail."))).toBe(true);
	});

	it("points the retention section at the Gmail section and states the backup window", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("What Readplace keeps from a connected Gmail account, and when it deletes each part, is set out under Connected Gmail accounts. Database backups keep a deleted record for up to 35 days.");
	});

	it("says how long a file uploaded before signing up is kept", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("A file you upload before signing up, with its name and what was read from it, is deleted within 2 days. Until you save it no account holds them, so you can't delete them sooner. Once you save it to your library, the file stays with your saved articles until you remove it; an audio or video file's transcript stays with it, and the transcription service's own copy of that transcript is deleted after 14 days.");
	});

	it("lists the optional display name among the account information Readplace keeps", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("the name you add on your Account page");
	});

	it("scopes the account-deletion claim to the saved list, highlights and notes, and reading history, not 'every saved article'", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("along with your saved list, your highlights and notes, and your reading history");
	});

	it("lists highlights and notes among the data Readplace collects", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		const doc = new JSDOM(response.text).window.document;
		const items = Array.from(doc.querySelectorAll("li"), (item) => item.textContent);
		expect(items).toContain("Highlights and notes: the passages you highlight in the reader and any note you add to one, stored with your account. They appear in your reader's markdown and EPUB downloads and in your account data export.");
	});

	it("says highlights and notes are deleted with the article and with the account", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		const doc = new JSDOM(response.text).window.document;
		const retention = Array.from(doc.querySelectorAll("p"), (p) => p.textContent).find((text) => text?.startsWith("Readplace keeps your account and saved articles"));
		expect(retention).toContain("Highlights and notes are deleted with the article, and with your account.");
	});

	it("says the export carries highlights and notes", async () => {
		const { server } = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(server).get("/privacy");

		expect(response.text).toContain("You can export a list of your saved articles, with their highlights and notes, at any time");
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
