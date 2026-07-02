import type { Request } from "express";
import type { SavedArticle } from "@packages/domain/article";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import type {
	FindArticleById,
	FindArticleUrlById,
} from "@packages/provider-contracts/article-store";
import type { Redirect } from "../../redirect.component";
import { shareUserIdPrefix } from "../../shared/share-user-id";
import { collectUtmParams } from "../../shared/utm";
import { viewPathFor } from "../view/view-path";
import {
	buildOwnerReaderPath,
	readerPermalinkPathWithoutMarker,
	wantsOwnerLogin,
} from "./owner-reader-link";

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
 * attribution survives the redirect. When the requester is logged in,
 * `utm_content` is overridden with their userId prefix so the receiving
 * `/view` page treats the link as permanent (no expiry); a re-shared
 * link therefore carries the latest sharer's trace, not the original. */
function buildShareRedirectUrl(
	articleUrl: string,
	query: Request["query"],
	requesterId: UserId | undefined,
): string {
	const incomingUtm = collectUtmParams(query);
	const params = new URLSearchParams(
		incomingUtm.length > 0
			? incomingUtm
			: [
				["utm_source", "read"],
				["utm_medium", "share"],
				["utm_campaign", "read-permalink"],
			],
	);
	if (requesterId !== undefined) {
		params.set("utm_content", shareUserIdPrefix(requesterId));
	}
	return `${viewPathFor(articleUrl)}?${params.toString()}`;
}

export function initReaderPermalink(deps: ReaderPermalinkDeps) {
	return async function resolveReaderPermalink(
		input: ReaderPermalinkInput,
	): Promise<ReaderPermalinkResult> {
		const parsedId = ReaderArticleHashIdSchema.safeParse(input.rawId);
		if (!parsedId.success) return REDIRECT_TO_QUEUE;

		if (input.requesterId === undefined && wantsOwnerLogin(input.query)) {
			return {
				kind: "redirect",
				redirect: {
					statusCode: 303,
					location: `/login?return=${encodeURIComponent(buildOwnerReaderPath(parsedId.data))}`,
				},
			};
		}

		const ownedArticle = input.requesterId
			? await deps.findArticleById(parsedId.data, input.requesterId)
			: null;
		if (ownedArticle) {
			/** The email marker only gates the logged-out → /login hop; once the
			 * owner is authenticated it is inert. Redirect to strip it so the
			 * address bar settles on the clean shareable permalink instead of the
			 * `?from=reader-ready-email` link the owner clicked from their inbox. */
			if (wantsOwnerLogin(input.query)) {
				return {
					kind: "redirect",
					redirect: {
						statusCode: 303,
						location: readerPermalinkPathWithoutMarker(parsedId.data, input.query),
					},
				};
			}
			return { kind: "article", article: ownedArticle };
		}

		const articleUrl = await deps.findArticleUrlById(parsedId.data);
		if (!articleUrl) return REDIRECT_TO_QUEUE;

		/** 302 (not 301) because the redirect is conditional on
		 * auth/ownership — the same URL renders differently for the
		 * owner, so caches must not pin a single response. */
		return {
			kind: "redirect",
			redirect: {
				statusCode: 302,
				location: buildShareRedirectUrl(articleUrl, input.query, input.requesterId),
			},
		};
	};
}
