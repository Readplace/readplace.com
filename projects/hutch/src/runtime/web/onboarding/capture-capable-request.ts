import type { Request } from "express";
import { isContentCaptureOAuthClientId } from "@packages/supported-clients";
import { isExtensionInstalled } from "./extension-install";
import { isNativeSurface } from "./native-client";

export function requestCanCapture(req: Request): boolean {
	if (isExtensionInstalled(req)) return true;
	if (isNativeSurface(req)) return true;
	return req.oauthClientId !== undefined && isContentCaptureOAuthClientId(req.oauthClientId);
}
