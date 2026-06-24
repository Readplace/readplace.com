import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";

/**
 * The resource id a received email's sanitized body is stored under in the
 * content bucket. The sort key is percent-encoded into a single
 * `email://inbox/<id>` path segment so its `#`/`<`/`>` characters can't be
 * mistaken for a URL fragment (which `normalizeUrl` would drop), keeping the id
 * 1:1 with the row. Shared by the receive path (write) and the detail page
 * (read) so both resolve the same S3 key.
 */
export function emailContentResourceId(
	receivedAtMessageId: string,
): ArticleResourceUniqueId {
	return ArticleResourceUniqueId.parse(
		`email://inbox/${encodeURIComponent(receivedAtMessageId)}`,
	);
}
