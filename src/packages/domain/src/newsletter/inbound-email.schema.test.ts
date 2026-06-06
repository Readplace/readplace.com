import {
	INBOUND_EMAIL_RECEIVED_TYPE,
	InboundEmailWebhookSchema,
	inboundRecipients,
} from "./inbound-email.schema";

describe("InboundEmailWebhookSchema", () => {
	it("parses a payload whose `to` is a single string", () => {
		const result = InboundEmailWebhookSchema.safeParse({
			type: INBOUND_EMAIL_RECEIVED_TYPE,
			created_at: "2026-06-05T10:00:00.000Z",
			data: {
				email_id: "abc-123",
				from: "news@substack.com",
				to: "token@inbox.readplace.com",
				subject: "Weekly digest",
			},
		});
		expect(result.success).toBe(true);
	});

	it("parses a payload whose `to` is an array", () => {
		const result = InboundEmailWebhookSchema.safeParse({
			type: INBOUND_EMAIL_RECEIVED_TYPE,
			created_at: "2026-06-05T10:00:00.000Z",
			data: {
				email_id: "abc-123",
				from: "news@substack.com",
				to: ["token@inbox.readplace.com", "cc@example.com"],
			},
		});
		expect(result.success).toBe(true);
	});

	it("rejects a payload missing the email id", () => {
		const result = InboundEmailWebhookSchema.safeParse({
			type: INBOUND_EMAIL_RECEIVED_TYPE,
			created_at: "2026-06-05T10:00:00.000Z",
			data: { from: "news@substack.com", to: "token@inbox.readplace.com" },
		});
		expect(result.success).toBe(false);
	});
});

describe("inboundRecipients", () => {
	it("wraps a single recipient string into an array", () => {
		expect(inboundRecipients("a@example.com")).toEqual(["a@example.com"]);
	});

	it("returns an array of recipients unchanged", () => {
		expect(inboundRecipients(["a@example.com", "b@example.com"])).toEqual([
			"a@example.com",
			"b@example.com",
		]);
	});
});
