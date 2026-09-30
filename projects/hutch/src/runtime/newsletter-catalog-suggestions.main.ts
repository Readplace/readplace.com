import { S3Client } from "@aws-sdk/client-s3";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { requireEnv } from "@packages/require-env";
import { initSubmitNewsletterSenderHandler } from "./domain/newsletter-catalog/submit-newsletter-sender-handler";
import { initUpdateNewsletterCatalog } from "./domain/newsletter-catalog/update-newsletter-catalog";
import { NEWSLETTER_CATALOG_OBJECT_KEY, initS3NewsletterCatalog } from "./providers/newsletter-catalog/s3-newsletter-catalog";

const logger = HutchLogger.from(consoleLogger);
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: requireEnv("EVENT_BUS_NAME") });
const catalog = initS3NewsletterCatalog({
	client: new S3Client({}),
	bucketName: requireEnv("NEWSLETTER_CATALOG_BUCKET_NAME"),
	key: NEWSLETTER_CATALOG_OBJECT_KEY,
	logger,
});

export const handler = initSubmitNewsletterSenderHandler({
	updateCatalog: initUpdateNewsletterCatalog({ readCatalog: catalog.readCatalog, writeCatalog: catalog.writeCatalog, maxAttempts: 3 }),
	publishEvent,
	now: () => new Date(),
	logger,
});
