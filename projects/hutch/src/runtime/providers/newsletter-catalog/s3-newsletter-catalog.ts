import assert from "node:assert";
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";
import { type NewsletterCatalogDocument, NewsletterCatalogDocumentSchema } from "@packages/domain/newsletter-catalog";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ReadNewsletterCatalog, WriteNewsletterCatalog } from "@packages/provider-contracts/newsletter-catalog";

export const NEWSLETTER_CATALOG_OBJECT_KEY = "newsletter-catalog.json";

const WRITE_CONFLICT_STATUSES: ReadonlySet<number | undefined> = new Set([409, 412]);

export function initS3NewsletterCatalog(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
	key: string;
	logger: HutchLogger;
}): { readCatalog: ReadNewsletterCatalog; writeCatalog: WriteNewsletterCatalog } {
	let cached: { etag: string; document: NewsletterCatalogDocument } | undefined;

	const readCatalog: ReadNewsletterCatalog = async () => {
		const revalidating = cached;
		try {
			const result = await deps.client.send(
				new GetObjectCommand({
					Bucket: deps.bucketName,
					Key: deps.key,
					...(revalidating === undefined ? {} : { IfNoneMatch: revalidating.etag }),
				}),
			);
			assert(result.Body, "a newsletter catalog object must have a body");
			assert(result.ETag, "a newsletter catalog object must have an ETag");
			const document = NewsletterCatalogDocumentSchema.parse(JSON.parse(await result.Body.transformToString()));
			cached = { etag: result.ETag, document };
			return { ok: true, document, etag: result.ETag };
		} catch (error) {
			if (error instanceof NoSuchKey) return { ok: true, document: { version: 1, records: [] }, etag: undefined };
			if (revalidating !== undefined && error instanceof S3ServiceException && error.$metadata.httpStatusCode === 304) {
				return { ok: true, document: revalidating.document, etag: revalidating.etag };
			}
			deps.logger.error("[newsletter-catalog] could not read the catalog", error);
			return { ok: false, reason: "unavailable" };
		}
	};

	const writeCatalog: WriteNewsletterCatalog = async ({ document, expectedEtag }) => {
		try {
			const result = await deps.client.send(
				new PutObjectCommand({
					Bucket: deps.bucketName,
					Key: deps.key,
					Body: JSON.stringify(document),
					ContentType: "application/json",
					...(expectedEtag === undefined ? { IfNoneMatch: "*" } : { IfMatch: expectedEtag }),
				}),
			);
			assert(result.ETag, "a stored newsletter catalog must have an ETag");
			cached = { etag: result.ETag, document };
			return { ok: true, etag: result.ETag };
		} catch (error) {
			if (error instanceof S3ServiceException && WRITE_CONFLICT_STATUSES.has(error.$metadata.httpStatusCode)) {
				return { ok: false, reason: "conflict" };
			}
			deps.logger.error("[newsletter-catalog] could not write the catalog", error);
			return { ok: false, reason: "unavailable" };
		}
	};

	return { readCatalog, writeCatalog };
}
