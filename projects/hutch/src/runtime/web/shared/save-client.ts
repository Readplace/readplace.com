import type { Request } from "express";
import { isReadplaceNativeClient } from "@packages/web-analytics";
import { SAVE_CLIENTS, type SaveClient } from "../../observability/events";
import { isIosSurface } from "../onboarding/ios-client";

export function saveClientOf(req: Request): SaveClient {
	const isNative = isIosSurface(req) || isReadplaceNativeClient(req.get("user-agent"));
	return isNative ? SAVE_CLIENTS.iosApp : SAVE_CLIENTS.web;
}
