import { articleHostFrom } from "@packages/web-analytics";

const RELATIVE_URL_BASE = "http://relative";

export function pendingSaveHostFrom(returnUrl: string | undefined): string | undefined {
	if (!returnUrl || !URL.canParse(returnUrl, RELATIVE_URL_BASE)) return undefined;
	const parsed = new URL(returnUrl, RELATIVE_URL_BASE);
	if (parsed.pathname !== "/save") return undefined;
	const articleUrl = parsed.searchParams.get("url");
	if (!articleUrl || !URL.canParse(articleUrl)) return undefined;
	const host = articleHostFrom(articleUrl);
	return host === "" ? undefined : host;
}
