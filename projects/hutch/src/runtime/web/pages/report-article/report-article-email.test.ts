import { JSDOM } from "jsdom";
import { REPORT_ADDRESS, REPORT_FROM, buildReportArticleEmail } from "./report-article-email";

const ARTICLE = { articleUrl: "https://readplace.com/view/example.com/post", title: "A post" };

function bodyText(html: string): string {
	return new JSDOM(html).window.document.body.textContent ?? "";
}

describe("buildReportArticleEmail", () => {
	it("addresses a signed-in reader's report to the report inbox, replying to the account email", () => {
		const message = buildReportArticleEmail({
			...ARTICLE,
			reason: "wrong-information",
			details: "The date is wrong",
			reporter: { kind: "account", email: "reader@example.com" },
		});

		expect({ from: message.from, to: message.to, replyTo: message.replyTo, subject: message.subject }).toEqual({
			from: REPORT_FROM,
			to: REPORT_ADDRESS,
			replyTo: "reader@example.com",
			subject: "[User report] Wrong information: A post",
		});
		const text = bodyText(message.html);
		expect(text).toContain("This is an automated email sent from a reader's report on Readplace.");
		expect(text).toContain("The date is wrong");
		expect(text).toContain("Signed-in reader reader@example.com");
	});

	it("replies to the email a logged-out reader gave", () => {
		const message = buildReportArticleEmail({ ...ARTICLE, reporter: { kind: "given", email: "guest@example.com" } });

		expect(message.replyTo).toBe("guest@example.com");
		expect(bodyText(message.html)).toContain("Not signed in, gave the email guest@example.com");
	});

	it("has no reply-to for an anonymous report and says no type or details were given", () => {
		const message = buildReportArticleEmail({ ...ARTICLE, reporter: { kind: "anonymous" } });

		expect("replyTo" in message).toBe(false);
		expect(message.subject).toBe("[User report] No type selected: A post");
		const text = bodyText(message.html);
		expect(text).toContain("None given.");
		expect(text).toContain("Not signed in, and gave no email");
	});
});
