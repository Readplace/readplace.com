import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { isPrivateItemIdentity } from "@packages/media-contracts";
import type { UserId } from "../user";
import { isNonArticleHost } from "./non-article-host";

export function isPrivateItemUrl(url: string): boolean {
	return isPrivateItemIdentity(ArticleResourceUniqueId.parse(url));
}

export type Viewer =
	| { readonly kind: "reader"; readonly userId: UserId }
	| { readonly kind: "anonymous" };

export const ANONYMOUS_VIEWER: Viewer = { kind: "anonymous" };

export function viewerFor(userId: UserId | undefined): Viewer {
	return userId === undefined ? ANONYMOUS_VIEWER : { kind: "reader", userId };
}

export function mayReadItem(read: { url: string; viewer: Viewer; ownerUserId: UserId | undefined }): boolean {
	if (!isPrivateItemUrl(read.url)) return true;
	return read.viewer.kind === "reader" && read.ownerUserId === read.viewer.userId;
}

export const PRIVATE_ITEM_STUB_TITLE = "Private upload";

const PUBLICLY_WITHHELD_IDENTITY_CHECKS: ReadonlyArray<(url: string) => boolean> = [isNonArticleHost, isPrivateItemUrl];

export function isPubliclyWithheld(url: string): boolean {
	return PUBLICLY_WITHHELD_IDENTITY_CHECKS.some((check) => check(url));
}
