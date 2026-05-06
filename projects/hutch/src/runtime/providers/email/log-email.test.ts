import { initLogEmail } from "./log-email";

describe("initLogEmail", () => {
	it("logs the email message to console", async () => {
		const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
		const { sendEmail } = initLogEmail();

		await sendEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Test Subject",
			html: "<p>Test</p>",
		});

		expect(consoleSpy).toHaveBeenCalledWith("[Email]", {
			from: "sender@example.com",
			to: "recipient@example.com",
			bcc: undefined,
			replyTo: undefined,
			subject: "Test Subject",
			html: "<p>Test</p>",
			text: undefined,
		});

		consoleSpy.mockRestore();
	});
});
