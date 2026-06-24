import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { UserId } from "@packages/domain/user";

/**
 * The resource id a received email's sanitized body is stored under in the
 * content bucket. Scoped by the owning `userId` exactly like the `inbox_emails`
 * row is partitioned, so two users whose rows happen to share a
 * `receivedAtMessageId` (same sender Message-ID at the same receipt instant)
 * never read or overwrite each other's private body. Both segments are
 * percent-encoded into single `email://inbox/<userId>/<id>` path segments so the
 * sort key's `#`/`<`/`>` characters can't be mistaken for a URL fragment (which
 * `normalizeUrl` would drop), keeping the id 1:1 with the row. Shared by the
 * receive path (write) and the detail page (read) so both resolve the same S3
 * key.
 */
export function emailContentResourceId(input: {
	userId: UserId;
	receivedAtMessageId: string;
}): ArticleResourceUniqueId {
	return ArticleResourceUniqueId.parse(
		`email://inbox/${encodeURIComponent(input.userId)}/${encodeURIComponent(
			input.receivedAtMessageId,
		)}`,
	);
}
