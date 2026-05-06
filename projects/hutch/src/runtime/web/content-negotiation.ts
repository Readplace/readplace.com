import type { Request } from "express";
import { SIREN_MEDIA_TYPE } from "./api/siren";

export function wantsSiren(req: Request): boolean {
	const acceptHeader = req.get("Accept") || "";
	return acceptHeader.includes(SIREN_MEDIA_TYPE);
}
