import type { Request } from "express";
import type { SavedArticle } from "@packages/domain/article";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type {
	FindArticleById,
	FindArticleUrlById,
} from "@packages/test-fixtures/providers/article-store";
import type { Redirect } from "../../redirect.component";
import { collectUtmParams } from "../../shared/utm";

export interface ReaderPermalinkDeps {
	findArticleById: FindArticleById;
	findArticleUrlById: FindArticleUrlById;
}

export interface ReaderPermalinkInput {
	rawId: string;
	requesterId: UserId | undefined;
	query: Request["query"];
}

export type ReaderPermalinkResult =
	| { kind: "redirect"; redirect: Redirect }
	| { kind: "article"; article: SavedArticle };

const REDIRECT_TO_QUEUE: ReaderPermalinkResult = {
	kind: "redirect",
	redirect: { statusCode: 303, location: "/queue" },
};

/** UTM params on the /view redirect let analytics distinguish shared
 * /read clicks from organic /view traffic. Preserve any incoming UTM
 * (e.g. a campaign-tagged share URL) over the defaults so external
 * attribution survives the redirect. */
function buildShareRedirectUrl(articleUrl: string, query: Request["query"]): string {
	const incomingUtm = collectUtmParams(query);
	const utmParams: [string, string][] = incomingUtm.length > 0
		? incomingUtm
		: [
			["utm_source", "read"],
			["utm_medium", "share"],
			["utm_campaign", "read-permalink"],
		];
	return `/view/${encodeURIComponent(articleUrl)}?${new URLSearchParams(utmParams).toString()}`;
}

export function initReaderPermalink(deps: ReaderPermalinkDeps) {
	return async function resolveReaderPermalink(
		input: ReaderPermalinkInput,
	): Promise<ReaderPermalinkResult> {
		const parsedId = ReaderArticleHashIdSchema.safeParse(input.rawId);
		if (!parsedId.success) return REDIRECT_TO_QUEUE;

		const ownedArticle = input.requesterId
			? await deps.findArticleById(parsedId.data, input.requesterId)
			: null;
		if (ownedArticle) return { kind: "article", article: ownedArticle };

		const articleUrl = await deps.findArticleUrlById(parsedId.data);
		if (!articleUrl) return REDIRECT_TO_QUEUE;

		/** 302 (not 301) because the redirect is conditional on
		 * auth/ownership — the same URL renders differently for the
		 * owner, so caches must not pin a single response. */
		return {
			kind: "redirect",
			redirect: { statusCode: 302, location: buildShareRedirectUrl(articleUrl, input.query) },
		};
	};
}
