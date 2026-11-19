import assert from "node:assert";
import type { Request, RequestHandler, Response } from "express";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import type {
	ConsumeRateLimit,
	RateLimitBucket,
} from "@packages/provider-contracts/rate-limit";
import { viewerOf } from "@packages/viewer-identity";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchApi } from "@packages/translations/hutch-api";
import { SAVE_REFUSAL_CODES } from "@packages/web-analytics";
import { SIREN_MEDIA_TYPE, sirenError } from "../api/siren";
import { tagSaveRefusal } from "../shared/save-refusal";

const { t } = translator(hutchApi, DEFAULT_LOCALE);

export function rateLimitKeyFromRequest(req: Request): string {
	// All clients without a resolvable address share one counter rather than
	// each receiving a fresh, unenforceable one.
	return viewerOf(req).ip ?? "unknown";
}

export function sendRateLimited(res: Response, retryAfterSeconds: number): void {
	res
		.status(429)
		.set("Retry-After", String(retryAfterSeconds))
		.type("text/plain")
		.send("Too many requests from your network. Please try again later.");
}

export const DAILY_SAVE_LIMIT_MESSAGE = t("saveLimit.daily");

export const OCR_PAGE_QUOTA_CODE = "ocr-page-quota";
export const OCR_PAGE_QUOTA_MESSAGE = t("saveLimit.ocrPages");

export function sendDailySaveLimit(res: Response, input: { retryAfterSeconds: number | undefined }): void {
	assert(input.retryAfterSeconds !== undefined, "a refused daily save carries the seconds until the window resets");
	tagSaveRefusal(res, SAVE_REFUSAL_CODES.dailySaveLimit);
	res
		.status(429)
		.set("Retry-After", String(input.retryAfterSeconds))
		.type(SIREN_MEDIA_TYPE)
		.json(sirenError({ code: SAVE_REFUSAL_CODES.dailySaveLimit, message: DAILY_SAVE_LIMIT_MESSAGE }));
}

export type OnRateLimited = (params: { req: Request; res: Response; retryAfterSeconds: number }) => void;

const sendPlainRateLimited: OnRateLimited = ({ res, retryAfterSeconds }) => {
	sendRateLimited(res, retryAfterSeconds);
};

export function createRateLimitMiddleware(deps: {
	consumeRateLimit: ConsumeRateLimit;
	bucket: RateLimitBucket;
	rule: RateLimitRule;
	onLimited?: OnRateLimited;
}): RequestHandler {
	const onLimited = deps.onLimited ?? sendPlainRateLimited;
	return (req, res, next) => {
		deps
			.consumeRateLimit({
				bucket: deps.bucket,
				key: rateLimitKeyFromRequest(req),
				rule: deps.rule,
			})
			.then((decision) => {
				if (!decision.allowed) {
					onLimited({ req, res, retryAfterSeconds: decision.retryAfterSeconds });
					return;
				}
				next();
			})
			// Express 4 does not forward rejected promises; route store failures
			// to the error middleware instead of leaving the request hanging.
			.catch(next);
	};
}
