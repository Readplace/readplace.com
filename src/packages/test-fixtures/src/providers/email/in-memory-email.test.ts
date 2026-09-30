import { initInMemoryEmail } from "./in-memory-email";

describe("initInMemoryEmail", () => {
	it("captures the custom headers of each sent message", async () => {
		const email = initInMemoryEmail();

		await email.sendEmail({
			from: "Readplace <hello@readplace.com>",
			to: "reader@example.com",
			subject: "Test Subject",
			html: "<p>Test</p>",
			headers: {
				"List-Unsubscribe": "<https://readplace.com/email/queue-digest/unsubscribe?t=token>",
				"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
			},
		});

		expect(email.getSentEmails().map((message) => message.headers)).toEqual([
			{
				"List-Unsubscribe": "<https://readplace.com/email/queue-digest/unsubscribe?t=token>",
				"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
			},
		]);
	});
});
