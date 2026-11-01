const COMMENT_VIEW_PATH = /^(\/p\/[^/]+)\/comments\/?$/;

export function toSubstackPostUrl(url: string): string {
	if (!URL.canParse(url)) return url;
	const parsed = new URL(url);
	const post = COMMENT_VIEW_PATH.exec(parsed.pathname);
	if (post === null) return url;
	if (parsed.searchParams.get("action") !== "post-comment") return url;
	if (parsed.searchParams.get("comments") !== "true") return url;
	parsed.pathname = post[1];
	parsed.searchParams.delete("action");
	parsed.searchParams.delete("comments");
	return parsed.href;
}
