export function readMetaTitle(info: Record<string, unknown> | undefined): string | undefined {
	if (!info) return undefined;
	const title = info.Title;
	if (typeof title !== "string") return undefined;
	const trimmed = title.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function deriveTitleFromUrl(url: string): string {
	try {
		const { pathname } = new URL(url);
		const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
		const withoutExt = lastSegment.replace(/\.pdf$/i, "");
		const slugged = withoutExt.replace(/[_-]+/g, " ").trim();
		return slugged.length > 0 ? slugged : "Untitled PDF";
	} catch {
		return "Untitled PDF";
	}
}

export { default as escapeHtmlText } from "escape-html";
