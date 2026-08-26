import type { Request } from "express";
import {
	APP_SHELL_QUERY,
	APP_SHELL_VALUE,
	PLATFORM_QUERY,
	isAppShell,
	isNativeSurface,
	nativeSurfaceOf,
} from "../../onboarding/native-client";
import { APP_BACK_LINK } from "../../shared/native-app-links";
import type { LinkParams } from "./queue.url";

const NATIVE_LIST_BACK_LABEL = "Back to Reading List";

export interface QueueSurface {
	backLink: { href: string; label: string };
}

export function appSurfaceLinkParams(req: Request): LinkParams {
	const platform = nativeSurfaceOf(req);
	return [
		...(platform ? [[PLATFORM_QUERY, platform] as const] : []),
		...(isAppShell(req) ? [[APP_SHELL_QUERY, APP_SHELL_VALUE] as const] : []),
	];
}

export function appSurfaceOf(req: Request): QueueSurface | undefined {
	if (!isNativeSurface(req)) return undefined;
	return { backLink: { href: APP_BACK_LINK.topHref, label: NATIVE_LIST_BACK_LABEL } };
}
