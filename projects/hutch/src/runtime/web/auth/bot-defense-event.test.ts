import { createBotDefenseEvent } from "./bot-defense-event";

const REJECT_AT = new Date("2026-05-17T12:00:00.000Z");

describe("createBotDefenseEvent", () => {
	it("returns a signup_rejected event on the bot-defense stream with the trip reason and ISO timestamp", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: undefined,
			body: {},
			now: REJECT_AT,
		});
		expect(event).toEqual({
			stream: "bot-defense",
			event: "signup_rejected",
			reason: "honeypot",
			timestamp: "2026-05-17T12:00:00.000Z",
		});
	});

	it("includes the ip field when an ip is provided", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: "203.0.113.1",
			userAgent: undefined,
			body: {},
			now: REJECT_AT,
		});
		expect(event.ip).toBe("203.0.113.1");
	});

	it("omits the ip field when ip is undefined", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: undefined,
			body: {},
			now: REJECT_AT,
		});
		expect(event).not.toHaveProperty("ip");
	});

	it("omits the ip field when ip is an empty string", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: "",
			userAgent: undefined,
			body: {},
			now: REJECT_AT,
		});
		expect(event).not.toHaveProperty("ip");
	});

	it("includes user_agent when provided", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: "Mozilla/5.0 (compatible; FakeBot/1.0)",
			body: {},
			now: REJECT_AT,
		});
		expect(event.user_agent).toBe("Mozilla/5.0 (compatible; FakeBot/1.0)");
	});

	it("truncates user_agent to 200 characters", () => {
		const longUA = "A".repeat(300);
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: longUA,
			body: {},
			now: REJECT_AT,
		});
		expect(event.user_agent).toBe("A".repeat(200));
	});

	it("omits user_agent when undefined", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: undefined,
			body: {},
			now: REJECT_AT,
		});
		expect(event).not.toHaveProperty("user_agent");
	});

	it("omits user_agent when empty string", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: "",
			body: {},
			now: REJECT_AT,
		});
		expect(event).not.toHaveProperty("user_agent");
	});

	it("derives email_domain from body.email, lowercased", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: undefined,
			body: { email: "Bot@Example.COM" },
			now: REJECT_AT,
		});
		expect(event.email_domain).toBe("example.com");
	});

	it("omits email_domain when body.email is missing", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: undefined,
			body: {},
			now: REJECT_AT,
		});
		expect(event).not.toHaveProperty("email_domain");
	});

	it("omits email_domain when body.email is not a string", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: undefined,
			body: { email: 123 },
			now: REJECT_AT,
		});
		expect(event).not.toHaveProperty("email_domain");
	});

	it("omits email_domain when body.email has no @ sign", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: undefined,
			body: { email: "no-at-sign" },
			now: REJECT_AT,
		});
		expect(event).not.toHaveProperty("email_domain");
	});

	it("omits email_domain when the part after @ is empty", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: undefined,
			body: { email: "trailing@" },
			now: REJECT_AT,
		});
		expect(event).not.toHaveProperty("email_domain");
	});

	it("includes time_to_submit_ms when the trip provides it", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "submit_too_fast", timeToSubmitMs: 1234 },
			ip: undefined,
			userAgent: undefined,
			body: {},
			now: REJECT_AT,
		});
		expect(event.time_to_submit_ms).toBe(1234);
	});

	it("includes time_to_submit_ms when it is zero", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "submit_too_fast", timeToSubmitMs: 0 },
			ip: undefined,
			userAgent: undefined,
			body: {},
			now: REJECT_AT,
		});
		expect(event.time_to_submit_ms).toBe(0);
	});

	it("omits time_to_submit_ms when the trip does not provide it", () => {
		const event = createBotDefenseEvent({
			trip: { reason: "honeypot" },
			ip: undefined,
			userAgent: undefined,
			body: {},
			now: REJECT_AT,
		});
		expect(event).not.toHaveProperty("time_to_submit_ms");
	});
});
