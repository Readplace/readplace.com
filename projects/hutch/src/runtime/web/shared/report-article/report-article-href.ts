const REPORT_ADDRESS = "readplace+report@readplace.com";

export function reportArticleHref(article: { viewUrl: string; title: string }): string {
	const subject = encodeURIComponent(`Report: ${article.title}`);
	const body = encodeURIComponent(`Article: ${article.viewUrl}\n\nWhat is wrong with it?\n`);
	return `mailto:${REPORT_ADDRESS}?subject=${subject}&body=${body}`;
}
