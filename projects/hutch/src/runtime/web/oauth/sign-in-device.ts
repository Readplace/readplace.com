import type { OAuthSignInDevice } from "@packages/domain/oauth";
import { classifyBrowser, classifyOsFamily } from "@packages/web-analytics";

export function describeSignInDevice(userAgent: string | undefined): OAuthSignInDevice | undefined {
	const osFamily = classifyOsFamily(userAgent);
	const device: OAuthSignInDevice = { browser: classifyBrowser(userAgent), os: osFamily === "ereader" ? "other" : osFamily };
	return device.browser === "other" && device.os === "other" ? undefined : device;
}
