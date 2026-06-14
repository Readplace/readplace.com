import type { Request } from "express";
import { SIREN_MEDIA_TYPE } from "./api/siren";

export function wantsSiren(req: Request): boolean {
	const acceptHeader = req.get("Accept") || "";
	if (!acceptHeader.includes(SIREN_MEDIA_TYPE)) return false;
	return req.accepts(SIREN_MEDIA_TYPE) === SIREN_MEDIA_TYPE;
}
