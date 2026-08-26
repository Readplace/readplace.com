import type { Request } from "express";
import { readplaceNativeClientOf } from "@packages/web-analytics";
import { SAVE_CLIENTS, type SaveClient } from "../../observability/events";
import { isAppShell, nativeSurfaceOf } from "../onboarding/native-client";
import type { NativeClientPlatform } from "../onboarding/native-client";

const SAVE_CLIENT_BY_PLATFORM = {
	ios: SAVE_CLIENTS.iosApp,
	android: SAVE_CLIENTS.androidApp,
} as const satisfies Record<NativeClientPlatform, SaveClient>;

export function saveClientOf(req: Request): SaveClient {
	const platform = nativeSurfaceOf(req) ?? readplaceNativeClientOf(req.get("user-agent"));
	if (platform) return SAVE_CLIENT_BY_PLATFORM[platform];
	/* A sheet that names no platform can only be the shipped iOS build: it is the
	 * one release whose reader-view save carries `?shell=app` alone, and every app
	 * released since carries `?platform=` beside it. Without this arm those saves
	 * would silently file as web. */
	if (isAppShell(req)) return SAVE_CLIENTS.iosApp;
	return SAVE_CLIENTS.web;
}
