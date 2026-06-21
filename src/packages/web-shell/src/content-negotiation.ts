export const MARKDOWN_MEDIA_TYPE = "text/markdown";

export type AcceptNegotiable = {
	get(name: string): string | undefined;
	accepts(type: string): string | false;
};

export function wantsMarkdown(req: AcceptNegotiable): boolean {
	const acceptHeader = req.get("Accept") || "";
	if (!acceptHeader.includes(MARKDOWN_MEDIA_TYPE)) return false;
	return req.accepts(MARKDOWN_MEDIA_TYPE) === MARKDOWN_MEDIA_TYPE;
}
