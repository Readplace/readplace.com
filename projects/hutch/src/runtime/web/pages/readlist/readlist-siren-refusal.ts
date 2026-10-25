import type { Response } from "express";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";
import { READLIST_RENAME_REJECTIONS } from "./readlist.error";

type ReadlistRefusalCode = "unknown-readlist" | "invalid-name" | "reserved-name" | "name-taken" | "limit-reached";

const REFUSAL_STATUS: Record<ReadlistRefusalCode, 404 | 422> = {
	"unknown-readlist": 404,
	"invalid-name": 422,
	"reserved-name": 422,
	"name-taken": 422,
	"limit-reached": 422,
};

export interface ReadlistRefusal {
	code: ReadlistRefusalCode;
	message: string;
}

export const UNKNOWN_READLIST_REFUSAL: ReadlistRefusal = {
	code: "unknown-readlist",
	message: READLIST_RENAME_REJECTIONS["unknown-readlist"].message,
};

export function refuseOverSiren(res: Response, refusal: ReadlistRefusal): void {
	res.status(REFUSAL_STATUS[refusal.code]).type(SIREN_MEDIA_TYPE).json(sirenError(refusal));
}
