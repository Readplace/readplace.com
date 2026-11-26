import type { ErrorRequestHandler } from "express";
import type { SaveRefusalCode } from "@packages/web-analytics";
import type { LogError } from "@packages/logger";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE, type SirenAction, sirenError } from "../../api/siren";
import { tagSaveRefusal } from "../../shared/save-refusal";
import { megabytesLabel } from "../../shared/bytes-to-mb";
import { READLIST_PATH } from "./readlist.url";

export const SAVE_LINK_FALLBACK_ACTION: SirenAction = {
	name: "save-article",
	title: "Save a link",
	href: READLIST_PATH,
	method: "POST",
	type: "application/json",
	fields: [{ name: "url", type: "url" }],
};

export function initBodyTooLargeHandler(deps: {
	logError: LogError;
	maxBytes: number;
	logLabel: string;
	sirenError: {
		code: string;
		message: (label: string) => string;
		actions?: SirenAction[];
	};
	refusalCode?: SaveRefusalCode;
}): ErrorRequestHandler {
	const { maxBytes } = deps;
	const label = megabytesLabel(maxBytes);
	return (err, req, res, next) => {
		if (
			typeof err === "object" &&
			err !== null &&
			"type" in err &&
			err.type === "entity.too.large" &&
			"limit" in err &&
			err.limit === maxBytes &&
			wantsSiren(req)
		) {
			deps.logError(
				`${deps.logLabel} request body exceeded ${label}`,
				err instanceof Error ? err : undefined,
			);
			if (deps.refusalCode !== undefined) tagSaveRefusal(res, deps.refusalCode);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({
					code: deps.sirenError.code,
					message: deps.sirenError.message(label),
					actions: deps.sirenError.actions,
				}),
			);
			return;
		}
		next(err);
	};
}
