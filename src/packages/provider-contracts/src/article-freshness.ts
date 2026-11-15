import type { ParseArticleResult } from "@packages/article-parser";
import type { WrapperSourceBinding } from "./article-store";
import type { StaleCheckRequester } from "./events";

export type ResolvedSaveIdentity = { status: "resolved"; url: string; originalUrl: string } & (
	| WrapperSourceBinding
	| { contentSourceUrl?: undefined; sourceOriginalUrl?: undefined }
);

export type UnresolvedSaveIdentity = { status: "unresolved" };

export type SaveIdentityResult = ResolvedSaveIdentity | UnresolvedSaveIdentity;

type FreshnessIdentity = { identity?: ResolvedSaveIdentity };

export type ContentFreshnessResult = { action: "unresolved"; identity: UnresolvedSaveIdentity } | (FreshnessIdentity &
	(
		| { action: "new" }
		| { action: "skip" }
		| { action: "unchanged" }
		| { action: "refreshed"; article: ParseArticleResult & { ok: true } }
	));

export type ResolvedFreshnessResult = Exclude<ContentFreshnessResult, { action: "unresolved" }> & { identity: ResolvedSaveIdentity };

export type IdentifiedFreshnessResult = { action: "unresolved"; identity: UnresolvedSaveIdentity } | ResolvedFreshnessResult;

export type RefreshIdentifiedArticleIfStale = (params: {
	url: string;
	requester: StaleCheckRequester;
}) => Promise<IdentifiedFreshnessResult>;

export type RefreshArticleIfStale = (params: {
	url: string;
	requester: StaleCheckRequester;
}) => Promise<ContentFreshnessResult>;
