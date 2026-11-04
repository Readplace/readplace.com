import { S3Client } from "@aws-sdk/client-s3";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/infra-components/runtime";
import { Logger, consoleLogger } from "@packages/logger";
import { readEnv } from "@packages/require-env";
import { initSubmitNewsletterSenderHandler } from "./domain/newsletter-catalog/submit-newsletter-sender-handler";
import { initUpdateNewsletterCatalog } from "./domain/newsletter-catalog/update-newsletter-catalog";
import { NEWSLETTER_CATALOG_OBJECT_KEY, initS3NewsletterCatalog } from "./providers/newsletter-catalog/s3-newsletter-catalog";
import { NEWSLETTER_CATALOG_SUGGESTIONS_ENV } from "./newsletter-catalog-suggestions.env";

const env = readEnv(NEWSLETTER_CATALOG_SUGGESTIONS_ENV);

const logger = Logger.from(consoleLogger);
const { publishEvent } = initEventBridgePublisher({ client: new EventBridgeClient({}), eventBusName: env.EVENT_BUS_NAME });
const catalog = initS3NewsletterCatalog({
	client: new S3Client({}),
	bucketName: env.NEWSLETTER_CATALOG_BUCKET_NAME,
	key: NEWSLETTER_CATALOG_OBJECT_KEY,
	logger,
});

export const handler = initSubmitNewsletterSenderHandler({
	updateCatalog: initUpdateNewsletterCatalog({ readCatalog: catalog.readCatalog, writeCatalog: catalog.writeCatalog, maxAttempts: 3 }),
	publishEvent,
	now: () => new Date(),
	logger,
});
