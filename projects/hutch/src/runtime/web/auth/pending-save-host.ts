import { articleHostFrom } from "@packages/web-analytics";
import { returnUrlQueryParam } from "./return-url-param";

export function pendingSaveHostFrom(returnUrl: string | undefined): string | undefined {
	const articleUrl = returnUrlQueryParam({ returnUrl, path: "/save", param: "url" });
	if (!articleUrl || !URL.canParse(articleUrl)) return undefined;
	const host = articleHostFrom(articleUrl);
	return host === "" ? undefined : host;
}
