import type { RateLimitRule } from "@packages/domain/rate-limit";
import type { EmailMessage } from "@packages/provider-contracts/email";
import { PasswordResetTokenSchema } from "@packages/provider-contracts/password-reset";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import { initRequestPasswordReset, type PasswordResetRefusedEvent } from "./request-password-reset";

const DAILY: RateLimitRule = { limit: 5, windowSeconds: 86400 };

function recordingDeps(setup: {
	accountRule: RateLimitRule;
	existingEmails: string[];
	consumeRateLimit?: ConsumeRateLimit;
	sendEmail?: (message: EmailMessage) => Promise<void>;
}) {
	const sentEmails: EmailMessage[] = [];
	const lookups: string[] = [];
	const refusals: PasswordResetRefusedEvent[] = [];
	const loggedErrors: string[] = [];
	const captureRefusal = (event: PasswordResetRefusedEvent) => { refusals.push(event); };
	const requestPasswordReset = initRequestPasswordReset({
		consumeRateLimit:
			setup.consumeRateLimit ?? initInMemoryRateLimit({ now: () => new Date(1_700_000_000_000) }).consumeRateLimit,
		accountRule: setup.accountRule,
		userExistsByEmail: async (email) => {
			lookups.push(email);
			return setup.existingEmails.includes(email);
		},
		createPasswordResetToken: async () => PasswordResetTokenSchema.parse("reset-token-1"),
		sendEmail:
			setup.sendEmail ??
			(async (message) => {
				sentEmails.push(message);
			}),
		baseUrl: "https://readplace.test",
		logger: { info: captureRefusal, warn: captureRefusal, error: captureRefusal, debug: captureRefusal },
		logError: (message) => { loggedErrors.push(message); },
	});
	return { requestPasswordReset, sentEmails, lookups, refusals, loggedErrors };
}

describe("initRequestPasswordReset", () => {
	it("sends the reset link to the address exactly as the reader typed it", async () => {
		const { requestPasswordReset, sentEmails } = recordingDeps({
			accountRule: DAILY,
			existingEmails: ["Reader@Example.com"],
		});

		await requestPasswordReset({ email: "Reader@Example.com" });

		expect(sentEmails.map((message) => message.to)).toEqual(["Reader@Example.com"]);
		expect(sentEmails[0]?.html).toContain("reset-token-1");
	});

	it("counts an unknown address against its limit without sending anything", async () => {
		const { requestPasswordReset, sentEmails, refusals } = recordingDeps({
			accountRule: { limit: 1, windowSeconds: 86400 },
			existingEmails: [],
		});

		await requestPasswordReset({ email: "nobody@example.com" });
		await requestPasswordReset({ email: "nobody@example.com" });

		expect(sentEmails).toEqual([]);
		expect(refusals).toEqual([{ event: "password_reset_refused", key: "address", retryAfterSeconds: expect.any(Number) }]);
	});

	it("shares one counter across the case spellings of an address", async () => {
		const { requestPasswordReset, sentEmails } = recordingDeps({
			accountRule: { limit: 1, windowSeconds: 86400 },
			existingEmails: ["Reader@example.com", "reader@example.com"],
		});

		await requestPasswordReset({ email: "Reader@example.com" });
		await requestPasswordReset({ email: "reader@example.com" });

		expect(sentEmails.map((message) => message.to)).toEqual(["Reader@example.com"]);
	});

	it("shares one counter across the Gmail spellings of a mailbox", async () => {
		const { requestPasswordReset, sentEmails } = recordingDeps({
			accountRule: { limit: 1, windowSeconds: 86400 },
			existingEmails: ["j.doe+x@gmail.com", "jdoe@googlemail.com"],
		});

		await requestPasswordReset({ email: "j.doe+x@gmail.com" });
		await requestPasswordReset({ email: "jdoe@googlemail.com" });

		expect(sentEmails.map((message) => message.to)).toEqual(["j.doe+x@gmail.com"]);
	});

	it("refuses a spent address before looking the account up, logging only the key kind", async () => {
		const { requestPasswordReset, sentEmails, lookups, refusals } = recordingDeps({
			accountRule: DAILY,
			existingEmails: [],
			consumeRateLimit: async () => ({ allowed: false, retryAfterSeconds: 7200 }),
		});

		await requestPasswordReset({ email: "reader@example.com" });

		expect(lookups).toEqual([]);
		expect(sentEmails).toEqual([]);
		expect(refusals).toEqual([{ event: "password_reset_refused", key: "address", retryAfterSeconds: 7200 }]);
	});

	it("sends nothing when the address limit cannot be checked", async () => {
		const { requestPasswordReset, sentEmails, lookups, loggedErrors } = recordingDeps({
			accountRule: DAILY,
			existingEmails: ["reader@example.com"],
			consumeRateLimit: async () => {
				throw new Error("store unavailable");
			},
		});

		await requestPasswordReset({ email: "reader@example.com" });

		expect(lookups).toEqual([]);
		expect(sentEmails).toEqual([]);
		expect(loggedErrors).toEqual(["[RateLimit] Password reset address limit check failed"]);
	});

	it("logs a failed send and still resolves", async () => {
		const { requestPasswordReset, loggedErrors } = recordingDeps({
			accountRule: DAILY,
			existingEmails: ["reader@example.com"],
			sendEmail: () => Promise.reject("provider down"),
		});

		await requestPasswordReset({ email: "reader@example.com" });

		expect(loggedErrors).toEqual(["[Email] Password reset email failed"]);
	});

	it("counts a Gmail address that is only a +tag under its own spelling and sends nothing", async () => {
		const { requestPasswordReset, sentEmails, lookups, refusals } = recordingDeps({
			accountRule: { limit: 1, windowSeconds: 86400 },
			existingEmails: [],
		});

		await requestPasswordReset({ email: "+x@gmail.com" });
		await requestPasswordReset({ email: "+x@gmail.com" });

		expect(lookups).toEqual(["+x@gmail.com"]);
		expect(sentEmails).toEqual([]);
		expect(refusals).toEqual([{ event: "password_reset_refused", key: "address", retryAfterSeconds: expect.any(Number) }]);
	});
});
