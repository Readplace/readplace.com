import type { RequestHandler, Response } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	type AnalyticsEvent,
	buildSaveRefusedEvent,
	SAVE_REFUSAL_CODES,
	type SaveRefusalCode,
} from "@packages/web-analytics";
import { saveClientOf } from "./save-client";

const refusalTags = new WeakMap<Response, SaveRefusalCode>();

export function tagSaveRefusal(res: Response, code: SaveRefusalCode): void {
	refusalTags.set(res, code);
}

function refusalCodeOf(input: { status: number; tagged: SaveRefusalCode | undefined }): SaveRefusalCode {
	if (input.tagged !== undefined) return input.tagged;
	if (input.status === 401) return SAVE_REFUSAL_CODES.unauthenticated;
	if (input.status === 402) return SAVE_REFUSAL_CODES.noWriteAccess;
	if (input.status === 403) return SAVE_REFUSAL_CODES.locked;
	if (input.status === 429) return SAVE_REFUSAL_CODES.rateLimited;
	return SAVE_REFUSAL_CODES.other;
}

export function initObserveSaveRefusal(deps: {
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	now: () => Date;
	salt: string;
	path: string;
}): RequestHandler {
	return (req, res, next) => {
		res.on("finish", () => {
			if (res.statusCode < 400) return;
			deps.analytics.info(
				buildSaveRefusedEvent(
					{ now: deps.now, salt: deps.salt },
					{
						req,
						path: deps.path,
						status: res.statusCode,
						code: refusalCodeOf({ status: res.statusCode, tagged: refusalTags.get(res) }),
						client: saveClientOf(req),
					},
				),
			);
		});
		next();
	};
}
