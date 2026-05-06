/* c8 ignore start -- composition root, no logic to test */
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initDynamoDbPendingSignup } from "../providers/pending-signup/dynamodb-pending-signup";
import { initResendEmail } from "../providers/email/resend-email";
import { initStripeCheckout } from "../providers/stripe-checkout/stripe-checkout";
import { CheckoutRecoveryEmail } from "@packages/app/web/auth/checkout-recovery-email";
import { buildSignupResumeUrl } from "@packages/app/web/auth/signup-resume-url";
import { requireEnv } from "../require-env";
import { selectRecipients } from "./select-recipients";

async function main(): Promise<void> {
	const tableName = requireEnv("DYNAMODB_PENDING_SIGNUPS_TABLE");
	const stripeApiKey = requireEnv("STRIPE_SECRET_KEY");
	const stripePriceId = requireEnv("STRIPE_PRICE_ID");
	const resendApiKey = requireEnv("RESEND_API_KEY");
	const origin = requireEnv("READPLACE_ORIGIN");
	const from = requireEnv("RECOVERY_EMAIL_FROM");
	const replyTo = requireEnv("RECOVERY_EMAIL_REPLY_TO");
	const bcc = requireEnv("RECOVERY_EMAIL_BCC");

	const logger = HutchLogger.from(consoleLogger);

	const dynamoClient = createDynamoDocumentClient();
	const pendingSignup = initDynamoDbPendingSignup({ client: dynamoClient, tableName });
	const stripe = initStripeCheckout({
		apiKey: stripeApiKey,
		priceId: stripePriceId,
		fetch: globalThis.fetch,
	});
	const { sendEmail } = initResendEmail(resendApiKey);

	const founderAvatarUrl = `${origin}/fayner-brack.jpg`;

	logger.info(`[recovery] Scanning ${tableName} for pending signups…`);
	const rows = await pendingSignup.listAllPendingSignups();
	logger.info(`[recovery] Found ${rows.length} pending signup row(s).`);

	const { recipients, skipped } = await selectRecipients({
		now: new Date(),
		rows,
		retrieveCheckoutSession: stripe.retrieveCheckoutSession,
	});

	logger.info(
		`[recovery] ${recipients.length} candidate(s), ${skipped.length} skipped.`,
	);
	for (const skip of skipped) {
		logger.info(`[recovery]   skip ${skip.email} (${skip.reason})`);
	}

	let sent = 0;
	const errors: { email: string; error: string }[] = [];

	for (const recipient of recipients) {
		const resumeUrl = buildSignupResumeUrl({ origin, email: recipient.email });
		const email = CheckoutRecoveryEmail({
			founderAvatarUrl,
			resumeUrl,
			monthlyPrice: "$3.99",
			yearlyDiscount: "20%",
		});
		const message = {
			from,
			to: recipient.email,
			bcc,
			replyTo,
			subject: "Did something stop you?",
			html: email.to("text/html"),
			text: email.to("text/plain"),
		};

		try {
			await sendEmail(message);
			await pendingSignup.markCheckoutRecoveryEmailSent({
				checkoutSessionId: recipient.checkoutSessionId,
				sentAt: Math.floor(Date.now() / 1000),
			});
			sent++;
			logger.info(`[recovery] sent → ${recipient.email}`);
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			errors.push({ email: recipient.email, error });
			logger.error(`[recovery] FAILED → ${recipient.email}: ${error}`);
		}
	}

	logger.info(
		`[recovery] Done. ${recipients.length} candidate(s), ${skipped.length} skipped, ${sent} sent, ${errors.length} error(s).`,
	);
}

main().catch((err) => {
	console.error("[recovery] Fatal:", err);
	process.exit(1);
});
/* c8 ignore stop */
