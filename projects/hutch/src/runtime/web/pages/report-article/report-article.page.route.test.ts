import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";
import { REPORT_ADDRESS, REPORT_FROM } from "./report-article-email";

const useApp = useTestServer();

const SEND_PATH = "/report-article?utm_source=article-report&utm_medium=internal&utm_content=report-send&utm_term=reader-public";
const OPENED_PATH = "/report-article/opened?utm_source=article-report&utm_medium=internal&utm_content=report-open&utm_term=reader";
const ARTICLE = `${TEST_APP_ORIGIN}/view/example.com/post`;
const EMPTY_REPORT = { article: ARTICLE, title: "A post", surface: "reader-public", reason: "", details: "", email: "" };

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

describe("POST /report-article/opened", () => {
	it("answers the dialog's open beacon with an empty 204", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post(OPENED_PATH);

		expect({ status: response.status, text: response.text }).toEqual({ status: 204, text: "" });
	});
});

describe("POST /report-article", () => {
	it("sends an empty report as an automated email to the report address, with no type and no reply-to", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post(SEND_PATH).type("form").send(EMPTY_REPORT);

		expect(response.status).toBe(303);
		const sent = harness.email.getSentEmails();
		expect(sent.map(({ from, to, replyTo, subject }) => ({ from, to, replyTo, subject }))).toEqual([
			{ from: REPORT_FROM, to: REPORT_ADDRESS, replyTo: undefined, subject: "[User report] No type selected: A post" },
		]);
		const body = parse(sent[0].html).body.textContent ?? "";
		expect(body).toContain("This is an automated email sent from a reader's report on Readplace.");
		expect(body).toContain(ARTICLE);
		expect(body).toContain("Not signed in, and gave no email");
	});

	it("takes a report with no fields at all beyond the article it names", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post(SEND_PATH)
			.type("form")
			.send({ article: ARTICLE, title: "A post", surface: "reader-public" });

		expect({ status: response.status, sent: harness.email.getSentEmails().length }).toEqual({ status: 303, sent: 1 });
	});

	it("redirects a plain form post back to the article's public view", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post(SEND_PATH).type("form").send(EMPTY_REPORT);

		expect(response.headers.location).toBe("/view/example.com/post");
	});

	it("answers an htmx post with the thanks panel in place of the form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post(SEND_PATH)
			.set("HX-Request", "true")
			.type("form")
			.send(EMPTY_REPORT);

		expect(response.status).toBe(200);
		const doc = parse(response.text);
		expect(doc.querySelector("[data-test-report-sent]")?.textContent).toContain("Thanks, your report was sent.");
	});

	it.each([
		["bad-summary", "Bad summary"],
		["wrong-information", "Wrong information"],
		["spam-abuse", "Spam or abuse"],
		["illegal-content", "Illegal content"],
		["other", "Other"],
	])("names the %s type by its label", async (reason, label) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		await request(harness.server).post(SEND_PATH).type("form").send({ ...EMPTY_REPORT, reason });

		const [message] = harness.email.getSentEmails();
		expect(message.subject).toBe(`[User report] ${label}: A post`);
		expect(parse(message.html).body.textContent).toContain(`Type: ${label}`);
	});

	it("escapes the reader's details in the email", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		await request(harness.server)
			.post(SEND_PATH)
			.type("form")
			.send({ ...EMPTY_REPORT, details: "<script>alert(1)</script> is in the body" });

		const [message] = harness.email.getSentEmails();
		expect(message.html).not.toContain("<script>");
		expect(parse(message.html).body.textContent).toContain("<script>alert(1)</script> is in the body");
	});

	it("replies to the email a logged-out reader gave", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		await request(harness.server).post(SEND_PATH).type("form").send({ ...EMPTY_REPORT, email: "reader@example.com" });

		const [message] = harness.email.getSentEmails();
		expect(message.replyTo).toBe("reader@example.com");
		expect(parse(message.html).body.textContent).toContain("Not signed in, gave the email reader@example.com");
	});

	it("replies to a signed-in reader's account email, ignoring any email field", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.post(SEND_PATH).type("form").send({ ...EMPTY_REPORT, email: "someone-else@example.com" });

		const [message] = harness.email.getSentEmails();
		expect(message.replyTo).toBe("test@example.com");
		expect(parse(message.html).body.textContent).toContain("Signed-in reader test@example.com");
	});

	it("sends a signed-in reader's report with no reply-to when the account has no email on record", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({ ...fixture, auth: { ...fixture.auth, findEmailByUserId: async () => null } });
		const agent = await loginAgent(harness.server, harness.auth);

		await agent.post(SEND_PATH).type("form").send(EMPTY_REPORT);

		const [message] = harness.email.getSentEmails();
		expect(message.replyTo).toBeUndefined();
	});

	it.each([
		["an article on another origin", { article: "https://evil.example/view/example.com/post" }],
		["an article outside /view", { article: `${TEST_APP_ORIGIN}/queue` }],
		["an article that is not a URL", { article: "not a url" }],
		["an email that is not an email", { email: "not-an-email" }],
		["an unknown type", { reason: "rude" }],
	])("refuses %s without sending anything", async (_case, override) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).post(SEND_PATH).type("form").send({ ...EMPTY_REPORT, ...override });

		expect({ status: response.status, sent: harness.email.getSentEmails().length }).toEqual({ status: 400, sent: 0 });
	});

	it("keeps what the reader wrote and shows the error line when the email cannot be sent", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const loggedErrors: string[] = [];
		const harness = useApp({
			...fixture,
			email: { ...fixture.email, sendEmail: async () => { throw new Error("Email service down"); } },
			shared: { ...fixture.shared, logError: (message) => { loggedErrors.push(message); } },
		});

		const response = await request(harness.server)
			.post(SEND_PATH)
			.set("HX-Request", "true")
			.type("form")
			.send({ ...EMPTY_REPORT, reason: "spam-abuse", details: "Ads everywhere", email: "reader@example.com" });

		expect(response.status).toBe(502);
		const doc = parse(response.text);
		const error = doc.querySelector("[data-test-report-error]");
		assert(error, "the re-rendered form must carry its error line");
		expect({
			error: error.textContent,
			reason: doc.querySelector<HTMLInputElement>('[data-test-report-reason="spam-abuse"]')?.checked,
			details: doc.querySelector("[data-test-report-details]")?.textContent,
			email: doc.querySelector("[data-test-report-email]")?.getAttribute("value"),
			logged: loggedErrors,
		}).toEqual({
			error: "Your report couldn't be sent. Try again in a moment.",
			reason: true,
			details: "Ads everywhere",
			email: "reader@example.com",
			logged: ["[ReportArticle] Failed to send report email"],
		});
	});

	it("logs a non-Error rejection from the email provider as an Error", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const loggedErrors: (Error | undefined)[] = [];
		const harness = useApp({
			...fixture,
			email: { ...fixture.email, sendEmail: () => Promise.reject("provider said no") },
			shared: { ...fixture.shared, logError: (_message, error) => { loggedErrors.push(error); } },
		});

		const response = await request(harness.server).post(SEND_PATH).type("form").send(EMPTY_REPORT);

		expect({ status: response.status, logged: loggedErrors.map((error) => error?.message) }).toEqual({
			status: 502,
			logged: ["provider said no"],
		});
	});
});
