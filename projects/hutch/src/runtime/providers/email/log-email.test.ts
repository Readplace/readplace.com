import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initLogEmail } from "./log-email";

describe("initLogEmail", () => {
	it("logs the email message through the injected logger", async () => {
		const infoSpy = jest.fn();
		const logger = HutchLogger.from({ ...noopLogger, info: infoSpy });
		const { sendEmail } = initLogEmail({ logger });

		await sendEmail({
			from: "sender@example.com",
			to: "recipient@example.com",
			subject: "Test Subject",
			html: "<p>Test</p>",
		});

		expect(infoSpy).toHaveBeenCalledWith("[Email]", {
			from: "sender@example.com",
			to: "recipient@example.com",
			bcc: undefined,
			replyTo: undefined,
			subject: "Test Subject",
			html: "<p>Test</p>",
			text: undefined,
		});
	});
});
