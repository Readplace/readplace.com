import assert from "node:assert";
import Handlebars from "handlebars";

export function staleNoticeHtml(params: {
	url: string;
	siteName: string;
	hasOrigin: boolean;
	kindNoun: string | undefined;
}): string {
	const { escapeExpression } = Handlebars.Utils;
	if (!params.hasOrigin) {
		assert(params.kindNoun, "a private item always carries a media kind");
		return `Taking a while — we're still preparing this ${escapeExpression(params.kindNoun)}.`;
	}
	const destination = params.siteName ? escapeExpression(params.siteName) : "the source";
	return `Taking a while — <a href="${escapeExpression(params.url)}" target="_blank" rel="noopener">open on ${destination}</a>`;
}
