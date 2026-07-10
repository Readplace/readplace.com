import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { requireEnv } from "@packages/require-env";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { formatReconcileReport, reconcile } from "../domain/stripe-reconcile/reconcile";
import { initStripeSubscriptions } from "../providers/stripe-subscriptions/stripe-subscriptions";

const logger = HutchLogger.from(consoleLogger);

async function main(): Promise<void> {
	const tableName = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
	const stripeApiKey = requireEnv("STRIPE_SECRET_KEY");

	const reads = initDynamoDbSubscriptionRead({
		client: createDynamoDocumentClient(),
		tableName,
	});
	const stripe = initStripeSubscriptions({ apiKey: stripeApiKey, fetch: globalThis.fetch });

	logger.info(`[stripe-reconcile] Scanning ${tableName}…`);
	const appRows = await reads.listAllSubscriptionRows();
	logger.info(`[stripe-reconcile] Found ${appRows.length} app subscription row(s).`);

	const stripeSubs = await stripe.listAllSubscriptions();
	logger.info(`[stripe-reconcile] Listed ${stripeSubs.length} Stripe subscription(s).`);

	const findings = reconcile({ now: new Date(), appRows, stripeSubs });
	for (const line of formatReconcileReport(findings)) logger.info(line);
}

main().catch((err) => {
	logger.error("[stripe-reconcile] Fatal:", err);
	process.exit(1);
});
