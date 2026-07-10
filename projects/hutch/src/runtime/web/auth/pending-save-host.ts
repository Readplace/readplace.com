import { articleHostFrom } from "@packages/web-analytics";

export function pendingSaveHostFrom(returnUrl: string | undefined): string | undefined {
	if (!returnUrl) return undefined;
	const parsed = new URL(returnUrl, "http://relative");
	if (parsed.pathname !== "/save") return undefined;
	const articleUrl = parsed.searchParams.get("url");
	if (!articleUrl || !URL.canParse(articleUrl)) return undefined;
	return articleHostFrom(articleUrl);
}
