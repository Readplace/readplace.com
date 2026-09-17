import assert from "node:assert";
import type { Request } from "express";
import type { UserId } from "@packages/domain/user";
import { getBuiltInClient } from "@packages/domain/oauth";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import type { CountArticlesByUser } from "@packages/provider-contracts/article-store";
import type { RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import type { SaveArticleAtReadlistTop } from "@packages/save-article";
import {
	buildFirstArticleSeededEvent,
	buildSaveIntentEvent,
	SAVE_OUTCOMES,
	SAVE_SURFACES,
	type AnalyticsEvent,
	type FirstArticleSeededOutcome,
	type RecordAudienceEvent,
	type SaveOutcome,
} from "@packages/web-analytics";
import { FIRST_ARTICLE_SEEDED_OUTCOMES } from "../../observability/events";
import { resolveSaveProvenance } from "../shared/save-provenance";
import { saveClientOf } from "../shared/save-client";

const CONSENT_SEED_ARTICLE_URL =
	"https://fagnerbrack.com/whats-the-point-to-save-articles-youll-never-read-22d07f6609ad";

const CONSENT_SEED_PATH = "/oauth/authorize";

export type SeedFirstArticleOnConsent = (
	req: Request,
	params: { userId: UserId; clientId: string | undefined },
) => Promise<void>;

interface SeedFirstArticleOnConsentDependencies {
	countArticlesByUser: CountArticlesByUser;
	resolveSaveAccess: (userId: UserId) => Promise<{ readonly allowed: boolean }>;
	getEffectiveAccess: GetEffectiveAccess;
	validateSaveableUrl: ValidateSaveableUrl;
	refreshArticleIfStale: RefreshArticleIfStale;
	saveArticleAtReadlistTop: SaveArticleAtReadlistTop;
	recordAnalyticsEvent: RecordAudienceEvent<AnalyticsEvent>;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	salt: string;
}

export function initSeedFirstArticleOnConsent(
	deps: SeedFirstArticleOnConsentDependencies,
): SeedFirstArticleOnConsent {
	const recordSeeded = (req: Request, outcome: FirstArticleSeededOutcome, clientId: string, userId: UserId) =>
		deps.recordAnalyticsEvent(
			req,
			buildFirstArticleSeededEvent(
				{ now: deps.now, salt: deps.salt },
				{ req, outcome, oauthClientId: clientId, userId, url: CONSENT_SEED_ARTICLE_URL },
			),
		);
	const recordSaveIntent = (req: Request, outcome: SaveOutcome) =>
		deps.recordAnalyticsEvent(
			req,
			buildSaveIntentEvent(
				{ now: deps.now, salt: deps.salt },
				{
					req,
					url: CONSENT_SEED_ARTICLE_URL,
					path: CONSENT_SEED_PATH,
					surface: SAVE_SURFACES.oauthConsentSeed,
					outcome,
					client: saveClientOf(req),
				},
			),
		);

	return async (req, { userId, clientId }) => {
		if (clientId === undefined) return;
		if (getBuiltInClient(clientId) !== undefined) return;
		if ((await deps.countArticlesByUser({ userId, countLimit: 1 })) !== 0) return;
		if (!(await deps.resolveSaveAccess(userId)).allowed) return;
		if ((await deps.getEffectiveAccess(userId)).access !== "full") return;

		const validation = deps.validateSaveableUrl(CONSENT_SEED_ARTICLE_URL);
		assert(validation.status === "SUCCESS", "the consent seed URL must be saveable");
		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			await deps.saveArticleAtReadlistTop({
				userId,
				url: validation.url,
				freshness,
				provenance: resolveSaveProvenance(req.oauthClientId),
			});
			recordSeeded(req, FIRST_ARTICLE_SEEDED_OUTCOMES.saved, clientId, userId);
			recordSaveIntent(req, SAVE_OUTCOMES.saved);
		} catch (error) {
			deps.logError("Consent seed save failed", error instanceof Error ? error : undefined);
			recordSeeded(req, FIRST_ARTICLE_SEEDED_OUTCOMES.error, clientId, userId);
			recordSaveIntent(req, SAVE_OUTCOMES.error);
		}
	};
}
