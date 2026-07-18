import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { DeleteContentObjects } from "./s3-delete-content-objects";
import type { ListContentKeys } from "./s3-list-content-keys";

/** Delete every stored S3 object for a URL: the canonical body, rehosted
 * images, per-tier sources with their sidecars, and every dated version
 * snapshot. CDN edge copies of rehosted images may outlive the delete for up
 * to the cache TTL (~24h); no invalidation is issued. */
export type PurgeArticleContent = (url: string) => Promise<void>;

export function initPurgeArticleContent(deps: {
	listContentKeys: ListContentKeys;
	deleteContentObjects: DeleteContentObjects;
}): { purgeArticleContent: PurgeArticleContent } {
	const purgeArticleContent: PurgeArticleContent = async (url) => {
		const id = ArticleResourceUniqueId.parse(url);
		const prefixed = await Promise.all([
			deps.listContentKeys(id.toS3ImagePrefix()),
			deps.listContentKeys(id.toS3SourcesPrefix()),
			deps.listContentKeys(id.toS3ContentVersionsPrefix()),
		]);
		await deps.deleteContentObjects([id.toS3ContentKey(), ...prefixed.flat()]);
	};

	return { purgeArticleContent };
}
