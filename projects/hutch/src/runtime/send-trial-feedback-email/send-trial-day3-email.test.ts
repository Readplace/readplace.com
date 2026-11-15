import assert from "node:assert/strict";
import { MinutesSchema, type SaveProvenance } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { Logger, noopLogger } from "@packages/logger";
import type { UserContact } from "@packages/provider-contracts/auth";
import type { SendEmail } from "@packages/provider-contracts/email";
import type { ReleaseTrialNudge } from "@packages/provider-contracts/subscription-providers";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryEmail } from "@packages/test-fixtures/providers/email";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { initQueueDigestUnsubscribeToken } from "../domain/email/queue-digest-unsubscribe-token";
import { initEmitLifecycleEmailSent, type LifecycleEmailSentEvent } from "../observability/lifecycle-email-events";
import { UNSUBSCRIBE_LABEL } from "../web/queue-digest-email";
import { EMAIL_POSTAL_ADDRESS } from "../web/email-copy";
import { RENEWAL_PRICES } from "../web/price-statement";
import { initSendTrialFeedbackEmailHandler } from "./send-trial-feedback-email-handler";

const USER_ID = UserIdSchema.parse("7".repeat(32));
const APP_ORIGIN = "https://readplace.com";
const REGISTERED_AT = new Date("2026-11-06T00:00:00.000Z");
const TRIAL_ENDS_AT = "2026-11-20T00:00:00.000Z";
const FIRED_AT = new Date("2026-11-09T00:00:00.000Z");
const TRACKING = "utm_source=day3-email&utm_medium=email&utm_campaign=trial-keep";
const unsubscribeToken = initQueueDigestUnsubscribeToken("test-signing-key");

const CONTACT: UserContact = {
	email: "reader@example.com",
	emailVerified: true,
	queueDigestOptOutAt: undefined,
	registeredAt: REGISTERED_AT.toISOString(),
	earlyIntentionalSaves: 1,
};

function hoursAfterSignup(hours: number): Date {
	return new Date(REGISTERED_AT.getTime() + hours * 60 * 60 * 1000);
}

function buildSubject(options: { contact?: UserContact | null; sendEmail?: SendEmail; now?: Date; rowsCarryProvenance?: boolean; releaseTrialNudge?: ReleaseTrialNudge } = {}) {
	const providers = initInMemorySubscriptionProviders({ now: () => FIRED_AT });
	const email = initInMemoryEmail();
	const articleStore = initInMemoryArticleStore();
	const lifecycleEvents: LifecycleEmailSentEvent[] = [];
	const infoLines: unknown[][] = [];
	const errorLines: unknown[][] = [];
	const captureLifecycleEvent = (event: LifecycleEmailSentEvent) => { lifecycleEvents.push(event); };
	const now = options.now ?? FIRED_AT;
	const contact = options.contact === undefined ? CONTACT : options.contact;
	const handler = initSendTrialFeedbackEmailHandler({
		findSubscriptionByUserId: providers.findByUserId,
		findEmailByUserId: async () => CONTACT.email,
		findArticlesByUser: async (params) => {
			const result = await articleStore.findArticlesByUser(params);
			if (options.rowsCarryProvenance !== false) return result;
			return { ...result, articles: result.articles.map(({ provenance: _provenance, ...article }) => article) };
		},
		markTrialFeedbackEmailSent: providers.markTrialFeedbackEmailSent,
		markTrialReminderEmailSent: providers.markTrialReminderEmailSent,
		markAutomationSavesHeldEmailSent: providers.markAutomationSavesHeldEmailSent,
		markPaymentFailedEmailSent: providers.markPaymentFailedEmailSent,
		findOpenInvoiceFailure: async () => undefined,
		claimTrialNudge: providers.claimTrialNudge,
		releaseTrialNudge: options.releaseTrialNudge ?? providers.releaseTrialNudge,
		findUserContactByUserId: async () => contact,
		signUnsubscribeToken: unsubscribeToken.sign,
		sendEmail: options.sendEmail ?? email.sendEmail,
		founderAvatarUrl: "https://static.readplace.com/fayner-brack.jpg",
		appOrigin: APP_ORIGIN,
		now: () => now,
		logger: Logger.from({ ...noopLogger, info: (...line: unknown[]) => { infoLines.push(line); }, error: (...line: unknown[]) => { errorLines.push(line); } }),
		emitLifecycleEmailSent: initEmitLifecycleEmailSent({
			logger: { info: captureLifecycleEvent, error: captureLifecycleEvent, warn: captureLifecycleEvent, debug: captureLifecycleEvent },
			now: () => now,
		}),
	});
	return { handler, providers, email, articleStore, lifecycleEvents, infoLines, errorLines };
}

type Subject = ReturnType<typeof buildSubject>;

async function deliver(subject: Subject, messageId = "msg-day3") {
	return subject.handler(
		buildSqsEvent([{ messageId, body: JSON.stringify({ detail: { userId: USER_ID, kind: "trial_day3" } }) }]),
		buildLambdaContext(),
		() => {},
	);
}

async function save(
	subject: Subject,
	input: { slug: string; savedAt: Date; provenance?: SaveProvenance; url?: string },
) {
	const { saved } = await subject.articleStore.saveArticle({
		userId: USER_ID,
		url: input.url ?? `https://example.com/${input.slug}`,
		metadata: { title: `Title ${input.slug}`, siteName: "example.com", excerpt: "", wordCount: 400 },
		estimatedReadTime: MinutesSchema.parse(2),
		provenance: input.provenance ?? { kind: "web" },
		savedAt: input.savedAt,
	});
	return saved;
}

async function seedEligible(subject: Subject) {
	await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
	await save(subject, { slug: "one", savedAt: hoursAfterSignup(1) });
}

async function assertSkipped(subject: Subject, reason: string) {
	assert.deepEqual(subject.email.getSentEmails(), []);
	const row = await subject.providers.findByUserId(USER_ID);
	assert.equal(row?.trialDay3EmailSentAt, undefined);
	assert.deepEqual(subject.infoLines, [["[send-trial-feedback-email] trial_day3 noop", { userId: USER_ID, reason }]]);
}

function textOf(subject: Subject): string {
	const [message] = subject.email.getSentEmails();
	assert(message);
	assert(message.text);
	return message.text;
}

describe("trial day-3 email", () => {
	describe("guards", () => {
		it("sends nothing and sets no marker when there is no subscription row", async () => {
			const subject = buildSubject();

			await deliver(subject);

			await assertSkipped(subject, "not-trialing");
		});

		it("sends nothing when the reader has already subscribed", async () => {
			const subject = buildSubject();
			await seedEligible(subject);
			await subject.providers.upsertActive({ userId: USER_ID, subscriptionId: "sub", customerId: "cus" });

			await deliver(subject);

			await assertSkipped(subject, "not-trialing");
		});

		it("sends nothing when the trial was cancelled", async () => {
			const subject = buildSubject();
			await seedEligible(subject);
			await subject.providers.markCancelledByUserId({ userId: USER_ID });

			await deliver(subject);

			await assertSkipped(subject, "not-trialing");
		});

		it("sends nothing once the trial has ended, even with the row still trialing", async () => {
			const subject = buildSubject({ now: new Date(TRIAL_ENDS_AT) });
			await seedEligible(subject);

			await deliver(subject);

			await assertSkipped(subject, "not-trialing");
		});

		it("sends nothing when no contact exists", async () => {
			const subject = buildSubject({ contact: null });
			await seedEligible(subject);

			await deliver(subject);

			await assertSkipped(subject, "unverified");
		});

		it("sends nothing to an unverified address and sets no marker", async () => {
			const subject = buildSubject({ contact: { ...CONTACT, emailVerified: false } });
			await seedEligible(subject);

			await deliver(subject);

			await assertSkipped(subject, "unverified");
		});

		it("sends nothing to a reader who opted out and sets no marker", async () => {
			const subject = buildSubject({ contact: { ...CONTACT, queueDigestOptOutAt: "2026-11-07T00:00:00.000Z" } });
			await seedEligible(subject);

			await deliver(subject);

			await assertSkipped(subject, "opted-out");
		});

		it("sends nothing when the early intentional save count is zero", async () => {
			const subject = buildSubject({ contact: { ...CONTACT, earlyIntentionalSaves: 0 } });
			await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
			await save(subject, { slug: "starter", savedAt: hoursAfterSignup(1), provenance: { kind: "founder-seed" } });
			await save(subject, { slug: "gmail", savedAt: hoursAfterSignup(2), provenance: { kind: "email", senderEmail: "news@example.com" } });

			await deliver(subject);

			await assertSkipped(subject, "not-eligible");
		});

		it("sends nothing when every save since signup is gone from the readlist", async () => {
			const subject = buildSubject();
			await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
			await save(subject, { slug: "before-signup", savedAt: new Date(REGISTERED_AT.getTime() - 1) });

			await deliver(subject);

			await assertSkipped(subject, "not-eligible");
		});
	});

	describe("a trial too short for checkout to keep", () => {
		it("sends with exactly 48h05m left, the last instant checkout keeps the trial", async () => {
			const subject = buildSubject({ now: new Date("2026-11-17T23:55:00.000Z") });
			await seedEligible(subject);

			await deliver(subject);

			assert.equal(subject.email.getSentEmails().length, 1);
		});

		it("sends nothing one millisecond later, because checkout would charge at once", async () => {
			const subject = buildSubject({ now: new Date("2026-11-17T23:55:00.001Z") });
			await seedEligible(subject);

			await deliver(subject);

			await assertSkipped(subject, "trial-end-not-preserved");
		});
	});

	describe("once per reader", () => {
		it("sets the marker and sends no second email for a second message", async () => {
			const subject = buildSubject();
			await seedEligible(subject);

			await deliver(subject, "msg-first");
			await deliver(subject, "msg-second");

			assert.equal(subject.email.getSentEmails().length, 1);
			const row = await subject.providers.findByUserId(USER_ID);
			assert.equal(row?.trialDay3EmailSentAt, FIRED_AT.toISOString());
			assert.equal(row?.trialDay3EmailMessageId, "msg-first");
		});

		it("retries a redelivered message whose send failed", async () => {
			const email = initInMemoryEmail();
			let attempts = 0;
			const subject = buildSubject({
				sendEmail: async (message) => {
					attempts += 1;
					if (attempts === 1) throw new Error("provider down");
					await email.sendEmail(message);
				},
			});
			await seedEligible(subject);

			const failed = await deliver(subject);
			const retried = await deliver(subject);

			assert.deepEqual(failed, { batchItemFailures: [{ itemIdentifier: "msg-day3" }] });
			assert.deepEqual(retried, { batchItemFailures: [] });
			assert.equal(email.getSentEmails().length, 1);
		});

		it("releases the claim when the send fails, so a redrive under a new message id sends with the same idempotency key", async () => {
			const email = initInMemoryEmail();
			const idempotencyKeys: (string | undefined)[] = [];
			const subject = buildSubject({
				sendEmail: async (message) => {
					idempotencyKeys.push(message.idempotencyKey);
					if (idempotencyKeys.length === 1) throw new Error("provider down");
					await email.sendEmail(message);
				},
			});
			await seedEligible(subject);

			const failed = await deliver(subject, "msg-day3");
			const released = await subject.providers.findByUserId(USER_ID);
			const redriven = await deliver(subject, "msg-day3-redrive");

			assert.deepEqual(failed, { batchItemFailures: [{ itemIdentifier: "msg-day3" }] });
			assert.equal(released?.trialDay3EmailSentAt, undefined);
			assert.equal(released?.trialDay3EmailMessageId, undefined);
			assert.deepEqual(redriven, { batchItemFailures: [] });
			assert.equal(email.getSentEmails().length, 1);
			assert.deepEqual(idempotencyKeys, [`trial-day3-${USER_ID}`, `trial-day3-${USER_ID}`]);
			assert.equal((await subject.providers.findByUserId(USER_ID))?.trialDay3EmailMessageId, "msg-day3-redrive");
		});

		it("fails the record with the send error, and logs the release failure, when releasing the claim also fails", async () => {
			const subject = buildSubject({
				sendEmail: async () => { throw new Error("provider down"); },
				releaseTrialNudge: async () => { throw new Error("store down"); },
			});
			await seedEligible(subject);

			const failed = await deliver(subject, "msg-day3");

			assert.deepEqual(failed, { batchItemFailures: [{ itemIdentifier: "msg-day3" }] });
			const logged = JSON.stringify(subject.errorLines.map((line) => line.map((part) => JSON.stringify(part, (_key, value) => value instanceof Error ? value.message : value))));
			assert.match(logged, /trial_day3 release failed.*store down/);
			assert.match(logged, /record failed.*provider down/);
		});
	});

	describe("what is sent", () => {
		it("sends from the founder with the reply, bcc, idempotency key and unsubscribe headers", async () => {
			const subject = buildSubject();
			await seedEligible(subject);

			await deliver(subject);

			const [message] = subject.email.getSentEmails();
			assert(message);
			assert.equal(message.to, CONTACT.email);
			assert.equal(message.from, "Fayner from Readplace <fayner@readplace.com>");
			assert.equal(message.replyTo, "fayner@readplace.com");
			assert.equal(message.bcc, "readplace+trial_day3@readplace.com");
			assert.equal(message.idempotencyKey, `trial-day3-${USER_ID}`);
			assert.equal(message.subject, "the article you saved in Readplace");
			assert.deepEqual(message.headers, {
				"List-Unsubscribe": `<${APP_ORIGIN}/email/queue-digest/unsubscribe?t=${encodeURIComponent(unsubscribeToken.sign(USER_ID))}&kind=trial-day3>`,
				"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
			});
			const header = message.headers?.["List-Unsubscribe"];
			assert(header);
			const token = new URL(header.slice(1, -1)).searchParams.get("t");
			assert(token);
			assert.equal(unsubscribeToken.verify(token), USER_ID);
		});

		it("records the send with the trial day it went out on", async () => {
			const subject = buildSubject();
			await seedEligible(subject);

			await deliver(subject);

			assert.deepEqual(subject.lifecycleEvents, [
				{
					stream: "analytics",
					event: "lifecycle_email_sent",
					timestamp: FIRED_AT.toISOString(),
					user_id: USER_ID,
					kind: "trial-day3",
					trial_day: 4,
					utm_source: "day3-email",
					delivery: "automated",
				},
			]);
		});

		it("records no event when nothing is sent", async () => {
			const subject = buildSubject({ contact: { ...CONTACT, emailVerified: false } });
			await seedEligible(subject);

			await deliver(subject);

			assert.deepEqual(subject.lifecycleEvents, []);
		});

		it("names when the charge can start", async () => {
			const subject = buildSubject();
			await seedEligible(subject);

			await deliver(subject);

			assert.ok(textOf(subject).includes("nothing is charged until Nov 20, 2026"));
		});

		it("lists the newest five saves and says how many more wait", async () => {
			const subject = buildSubject();
			await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
			for (let hour = 1; hour <= 7; hour += 1) {
				await save(subject, { slug: `s${hour}`, savedAt: hoursAfterSignup(hour) });
			}

			await deliver(subject);

			const text = textOf(subject);
			for (const listed of ["s7", "s6", "s5", "s4", "s3"]) assert.ok(text.includes(`- Title ${listed} — `));
			for (const omitted of ["s2", "s1"]) assert.ok(!text.includes(`- Title ${omitted} — `));
			assert.ok(text.includes("You've saved 7 articles since Nov 6, 2026."));
			assert.ok(text.includes("and 2 more in your readlist."));
		});

		it("counts a founder seed out and one web save in", async () => {
			const subject = buildSubject();
			await seedEligible(subject);
			await save(subject, { slug: "seed", savedAt: hoursAfterSignup(2), provenance: { kind: "founder-seed" } });

			await deliver(subject);

			const text = textOf(subject);
			assert.ok(text.includes("You've saved 1 article since Nov 6, 2026. Here it is:"));
			assert.ok(!text.includes("Title seed"));
		});

		it("reads past one page of saves", async () => {
			const subject = buildSubject();
			await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
			for (let minute = 1; minute <= 53; minute += 1) {
				await save(subject, { slug: `m${minute}`, savedAt: new Date(REGISTERED_AT.getTime() + minute * 60_000) });
			}

			await deliver(subject);

			assert.ok(textOf(subject).includes("You've saved 53 articles"));
		});

		it("stops reading at the page that crosses signup, without counting what came before", async () => {
			const subject = buildSubject();
			await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
			for (let minute = 1; minute <= 60; minute += 1) {
				await save(subject, { slug: `old${minute}`, savedAt: new Date(REGISTERED_AT.getTime() - minute * 60_000) });
			}
			await save(subject, { slug: "new", savedAt: hoursAfterSignup(1) });

			await deliver(subject);

			assert.ok(textOf(subject).includes("You've saved 1 article since"));
		});

		it("shows a webmail save as its host stub", async () => {
			const subject = buildSubject();
			await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
			await save(subject, { slug: "mailbox", savedAt: hoursAfterSignup(1), url: "https://mail.google.com/mail/u/0/" });

			await deliver(subject);

			assert.ok(!textOf(subject).includes("Title mailbox"));
			assert.ok(textOf(subject).includes("mail.google.com"));
		});
	});

	describe("install link", () => {
		const IPHONE_LINK = `Get the iPhone app: ${APP_ORIGIN}/install?client=iphone&${TRACKING}&utm_content=install-iphone`;
		const EXTENSION_LINK = `Add the extension: ${APP_ORIGIN}/install?${TRACKING}&utm_content=install-extension`;

		async function deliverWith(provenances: SaveProvenance[]) {
			const subject = buildSubject();
			await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
			for (const [index, provenance] of provenances.entries()) {
				await save(subject, { slug: `p${index}`, savedAt: hoursAfterSignup(index + 1), provenance });
			}
			await deliver(subject);
			return textOf(subject);
		}

		it("offers the extension to a reader who saved only on the web", async () => {
			const text = await deliverWith([{ kind: "web" }]);

			assert.ok(text.split("\n").includes(EXTENSION_LINK));
			assert.ok(!text.includes(IPHONE_LINK));
		});

		it("offers the extension to a reader who saved only from the iPhone app", async () => {
			const text = await deliverWith([{ kind: "client", clientName: "iphone" }]);

			assert.ok(text.split("\n").includes(EXTENSION_LINK));
		});

		it("offers the extension to a reader who saved only through an assistant", async () => {
			const text = await deliverWith([{ kind: "mcp", registeredName: "Claude" }]);

			assert.ok(text.split("\n").includes(EXTENSION_LINK));
		});

		for (const browser of ["chrome", "firefox"]) {
			it(`offers the iPhone app to a reader who saved from ${browser}`, async () => {
				const text = await deliverWith([{ kind: "client", clientName: browser }]);

				assert.ok(text.split("\n").includes(IPHONE_LINK));
				assert.ok(!text.includes(EXTENSION_LINK));
			});
		}

		it("offers the extension to a reader whose save predates provenance, counting the save", async () => {
			const subject = buildSubject({ rowsCarryProvenance: false });
			await seedEligible(subject);

			await deliver(subject);

			const text = textOf(subject);
			assert.ok(text.split("\n").includes(EXTENSION_LINK));
			assert.ok(text.includes("You've saved 1 article since"));
		});

		it("sends the whole body with no install paragraph to a reader on both", async () => {
			const subject = buildSubject();
			await subject.providers.upsertTrialing({ userId: USER_ID, trialEndsAt: TRIAL_ENDS_AT });
			const browserSave = await save(subject, { slug: "browser", savedAt: hoursAfterSignup(1), provenance: { kind: "client", clientName: "chrome" } });
			const phoneSave = await save(subject, { slug: "phone", savedAt: hoursAfterSignup(2), provenance: { kind: "client", clientName: "iphone" } });

			await deliver(subject);

			const articleHref = (id: typeof browserSave.id) =>
				`${APP_ORIGIN}/queue/${id.value}/view?from=day3-email&${TRACKING}&utm_content=article`;
			const unsubscribeHref = `${APP_ORIGIN}/email/queue-digest/unsubscribe?t=${encodeURIComponent(unsubscribeToken.sign(USER_ID))}&kind=trial-day3&${TRACKING}&utm_content=unsubscribe`;
			assert.equal(
				textOf(subject),
				[
					"Your first 2 saves",
					"You've saved 2 articles since Nov 6, 2026. Here they are:",
					`- Title phone — example.com\n${articleHref(phoneSave.id)}`,
					`- Title browser — example.com\n${articleHref(browserSave.id)}`,
					`Choose during your trial: ${RENEWAL_PRICES} Add a card now and nothing is charged until Nov 20, 2026; you'll get an email a week before. Your saves stay readable and exportable either way.`,
					`Keep Readplace: ${APP_ORIGIN}/account/plans?${TRACKING}&utm_content=keep`,
					"If something didn't save the way you expected, reply to this email — it comes straight to me.",
					"— Fayner Brack, Founder & CEO",
					`You're getting this because you started a Readplace trial on Nov 6, 2026. ${UNSUBSCRIBE_LABEL}: ${unsubscribeHref} · Proficient Pty Ltd, ${EMAIL_POSTAL_ADDRESS}`,
				].join("\n\n"),
			);
		});
	});
});
