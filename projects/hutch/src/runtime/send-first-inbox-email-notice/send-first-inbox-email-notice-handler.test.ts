import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import type { SendEmail } from "@packages/provider-contracts/email";
import type { MarkFirstInboxEmailNoticeSent } from "@packages/provider-contracts/onboarding-signals";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryEmail } from "@packages/test-fixtures/providers/email";
import { initInMemoryOnboardingSignals } from "@packages/test-fixtures/providers/onboarding-signals";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import {
	initSendFirstInboxEmailNoticeHandler,
	type SendFirstInboxEmailNoticeDeps,
} from "./send-first-inbox-email-notice-handler";

const USER_ID = UserIdSchema.parse("6".repeat(32));
const FOUNDER_AVATAR_URL = "https://static.readplace.com/fayner-brack.jpg";
const SENT_AT = new Date("2026-06-04T10:00:00.000Z");
const INBOX_ADDRESS = "in-3f9a2c@read.place";
const RECEIVED_AT_MESSAGE_ID = "2026-06-04T08:00:00.000Z#<news@example.com>";

const EXPECTED_INBOX_URL =
	"https://readplace.com/inbox?highlight=2026-06-04T08%3A00%3A00.000Z%23%3Cnews%40example.com%3E&utm_source=first-inbox-email&utm_medium=email&utm_campaign=inbox-first-arrival";

const EXPECTED_TEXT = [
	"The first email to your Readplace inbox at in-3f9a2c@read.place just came through.",
	"From here on, every email sent to that address shows up in your inbox, and I pull the article links out of it and add them to your queue so you can read them later.",
	`See it in your inbox: ${EXPECTED_INBOX_URL}`,
	"If you have any questions, please reply to this email",
	"— Fayner",
].join("\n\n");

function buildBody(
	overrides: {
		userId?: string;
		receivedAtMessageId?: string;
		inboxAddress?: string;
	} = {},
): string {
	return JSON.stringify({
		detail: {
			userId: overrides.userId ?? USER_ID,
			receivedAtMessageId: overrides.receivedAtMessageId ?? RECEIVED_AT_MESSAGE_ID,
			inboxAddress: overrides.inboxAddress ?? INBOX_ADDRESS,
		},
	});
}

interface SubjectOverrides {
	findEmail?: (userId: string) => Promise<string | null>;
	sendEmail?: SendEmail;
	markFirstInboxEmailNoticeSent?: MarkFirstInboxEmailNoticeSent;
}

function buildSubject(overrides: SubjectOverrides = {}) {
	const providers = initInMemorySubscriptionProviders({
		now: () => new Date("2026-06-01T00:00:00.000Z"),
	});
	const onboarding = initInMemoryOnboardingSignals({ now: () => SENT_AT });
	const email = initInMemoryEmail();
	const findEmailByUserId = overrides.findEmail ?? (async () => "user@example.com");
	const deps: SendFirstInboxEmailNoticeDeps = {
		findSubscriptionByUserId: providers.findByUserId,
		findEmailByUserId,
		markFirstInboxEmailNoticeSent:
			overrides.markFirstInboxEmailNoticeSent ?? onboarding.markFirstInboxEmailNoticeSent,
		sendEmail: overrides.sendEmail ?? email.sendEmail,
		founderAvatarUrl: FOUNDER_AVATAR_URL,
		appOrigin: "https://readplace.com",
		now: () => SENT_AT,
		logger: HutchLogger.from(noopLogger),
	};
	const handler = initSendFirstInboxEmailNoticeHandler(deps);
	return { handler, providers, onboarding, email };
}

const run = (subject: ReturnType<typeof buildSubject>, body = buildBody()) =>
	subject.handler(
		buildSqsEvent([{ messageId: "msg-first", body }]),
		buildLambdaContext(),
		() => {},
	);

async function seedTrialing(
	providers: ReturnType<typeof initInMemorySubscriptionProviders>,
): Promise<void> {
	await providers.upsertTrialing({
		userId: USER_ID,
		trialEndsAt: "2026-06-05T00:00:00.000Z",
	});
}

async function seedCancelled(
	providers: ReturnType<typeof initInMemorySubscriptionProviders>,
): Promise<void> {
	await seedTrialing(providers);
	await providers.markCancelledByUserId({ userId: USER_ID });
}

describe("send-first-inbox-email-notice handler", () => {
	it("sends the notice and claims the marker for a reader who can save", async () => {
		const subject = buildSubject();
		await seedTrialing(subject.providers);

		const result = await run(subject);

		assert(result);
		assert.equal(result.batchItemFailures.length, 0);
		const sentEmails = subject.email.getSentEmails();
		assert.equal(sentEmails.length, 1);
		const sent = sentEmails[0];
		assert(sent, "the notice must have been sent");
		assert(sent.text, "the notice must carry a plain-text alternative");
		assert.equal(sent.from, "Fayner from Readplace <fayner@readplace.com>");
		assert.equal(sent.to, "user@example.com");
		assert.equal(sent.replyTo, "fayner@readplace.com");
		assert.equal(sent.bcc, "readplace+first_inbox_email@readplace.com");
		assert.equal(sent.subject, "Your first email landed in your Readplace inbox");
		assert.equal(sent.text, EXPECTED_TEXT);
		assert.ok(
			sent.html.includes(
				`<span style="white-space:nowrap;font-weight:700;">${INBOX_ADDRESS}</span>`,
			),
			"the hyphenated address must be bold, unbreakable and byte-exact in the HTML",
		);
		assert.ok(sent.html.includes("Your first email landed in your Readplace inbox"));
		assert.ok(sent.html.includes(`src="${FOUNDER_AVATAR_URL}"`));
		assert.ok(sent.html.includes('alt="Fayner Brack"'));
		assert.ok(sent.html.includes(">See it in your inbox</a>"));
		assert.ok(
			sent.html.includes("If you have any questions, please reply to this email"),
			"the reply invitation must render — it is only honest because replyTo is asserted above",
		);
		assert.equal(
			await subject.onboarding.markFirstInboxEmailNoticeSent({
				userId: USER_ID,
				sentAt: SENT_AT.toISOString(),
			}),
			"already-sent",
		);
	});

	it("sends for a founding member with no subscription row", async () => {
		const subject = buildSubject();

		await run(subject);

		assert.equal(subject.email.getSentEmails().length, 1);
	});

	it("sends only once across two commands for the same account", async () => {
		const subject = buildSubject();
		await seedTrialing(subject.providers);

		await run(subject);
		await run(subject);

		assert.equal(subject.email.getSentEmails().length, 1);
	});

	it("stays silent for a read-only reader, then sends once the reader can save again", async () => {
		const subject = buildSubject();
		await seedCancelled(subject.providers);

		await run(subject);
		assert.equal(subject.email.getSentEmails().length, 0);

		await subject.providers.markActive({ userId: USER_ID });
		await run(subject);
		assert.equal(subject.email.getSentEmails().length, 1);
	});

	it("stays silent with no email on file, then sends once an email exists", async () => {
		let email: string | null = null;
		const subject = buildSubject({ findEmail: async () => email });
		await seedTrialing(subject.providers);

		await run(subject);
		assert.equal(subject.email.getSentEmails().length, 0);

		email = "user@example.com";
		await run(subject);
		assert.equal(subject.email.getSentEmails().length, 1);
	});

	it("sends nothing when a concurrent delivery wins the marker claim", async () => {
		const subject = buildSubject({
			markFirstInboxEmailNoticeSent: async () => "already-sent",
		});
		await seedTrialing(subject.providers);

		await run(subject);

		assert.equal(subject.email.getSentEmails().length, 0);
	});

	it("reports a batch item failure for a malformed body", async () => {
		const subject = buildSubject();

		const result = await run(subject, "not-json");

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-first");
	});

	it("reports a batch item failure when sendEmail throws", async () => {
		const subject = buildSubject({
			sendEmail: async () => {
				throw new Error("Resend rejected");
			},
		});
		await seedTrialing(subject.providers);

		const result = await run(subject);

		assert(result);
		assert.equal(result.batchItemFailures.length, 1);
		assert.equal(result.batchItemFailures[0].itemIdentifier, "msg-first");
	});
});
