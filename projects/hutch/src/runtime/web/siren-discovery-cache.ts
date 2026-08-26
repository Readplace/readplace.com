import type { Request, Response } from "express";
import {
	NATIVE_CLIENT_HEADER,
	SAVE_CONTINUITY_HEADER,
	isNativeClient,
} from "./onboarding/native-client";

export const SIREN_DISCOVERY_MAX_AGE_SECONDS = 3600;

const MAX_AGE_DIRECTIVE = `private, max-age=${SIREN_DISCOVERY_MAX_AGE_SECONDS}`;
const REVALIDATE_DIRECTIVE = "private, no-cache";

const COLLECTION_VARY = [
	"Accept",
	"Authorization",
	NATIVE_CLIENT_HEADER,
	SAVE_CONTINUITY_HEADER,
].join(", ");

export function setSirenCollectionCaching(req: Request, res: Response): void {
	res.set("Cache-Control", isNativeClient(req) ? MAX_AGE_DIRECTIVE : REVALIDATE_DIRECTIVE);
	res.vary(COLLECTION_VARY);
}

export function setSirenDiscoveryRedirectCaching(res: Response): void {
	res.set("Cache-Control", MAX_AGE_DIRECTIVE);
	res.vary("Accept");
}
