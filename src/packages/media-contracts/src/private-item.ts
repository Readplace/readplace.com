import type { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { z } from "zod";
import { type UploadId, UploadIdSchema } from "./upload-id";

export const PRIVATE_ITEM_HOST = "uploads.readplace.invalid";

export const PrivateItemUrlSchema = z
	.string()
	.regex(/^https:\/\/uploads\.readplace\.invalid\/[0-9a-f]{32}$/)
	.brand<"PrivateItemUrl">();
export type PrivateItemUrl = z.infer<typeof PrivateItemUrlSchema>;

export function mintPrivateItemUrl(uploadId: UploadId): PrivateItemUrl {
	return PrivateItemUrlSchema.parse(`https://${PRIVATE_ITEM_HOST}/${uploadId}`);
}

export function isPrivateItemIdentity(id: ArticleResourceUniqueId): boolean {
	return new URL(`https://${id.value}`).hostname === PRIVATE_ITEM_HOST;
}

export function uploadIdOfPrivateItemUrl(url: PrivateItemUrl): UploadId {
	return UploadIdSchema.parse(new URL(url).pathname.slice(1));
}
