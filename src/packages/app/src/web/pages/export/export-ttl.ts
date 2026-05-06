/** Single source of truth for the export download lifetime. The S3 bucket
 * lifecycle, the presigned URL expiry, and the email copy ("link expires in
 * 7 days") all read from the same constant so they cannot drift.
 *
 * Bumping the number is a one-place change; the lifecycle rule and the
 * presigned URL TTL move together. */
export const EXPORT_DOWNLOAD_TTL_DAYS = 7;
export const EXPORT_DOWNLOAD_TTL_SECONDS = EXPORT_DOWNLOAD_TTL_DAYS * 24 * 60 * 60;

/** S3 key prefix shared between the worker that writes the export and the
 * lifecycle rule that expires it. Keeping the prefix as a constant means the
 * bucket-wide lifecycle filter and the worker's PutObject path cannot diverge. */
export const EXPORT_S3_KEY_PREFIX = "exports/";
