const NAMELESS_UPLOAD = "Audio upload";

function escapeHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function buildAudioBody(params: { title: string | undefined; fileName: string; minutes: number; notice?: string }): { title: string; html: string; excerpt: string; wordCount: number } {
	const title = params.title ?? params.fileName.replace(/\.[^.]+$/, "");
	const excerpt = `Audio, ${params.minutes} ${params.minutes === 1 ? "minute" : "minutes"}.`;
	const fileLine = params.fileName === NAMELESS_UPLOAD ? [] : [`File: ${params.fileName}`];
	const noticeLine = params.notice === undefined ? [] : [params.notice];
	const html = [`<h1>${escapeHtml(title)}</h1>`, `<p>${escapeHtml(excerpt)}</p>`, ...[...fileLine, ...noticeLine].map((line) => `<p>${escapeHtml(line)}</p>`)].join("");
	const wordCount = [title, excerpt, ...fileLine, ...noticeLine].join(" ").split(/\s+/).filter((word) => word.length > 0).length;
	return { title, html, excerpt, wordCount };
}
