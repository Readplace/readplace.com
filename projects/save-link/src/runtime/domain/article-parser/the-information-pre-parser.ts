import { parseHTML } from "linkedom";
import { z } from "zod";
import type { SiteArticleContent, SitePreParser } from "./article-parser.types";

const HOSTS = new Set(["www.theinformation.com", "theinformation.com"]);

/* Subset of the React-on-Rails Article component JSON we read. Unknown
 * keys are stripped silently (default zod behavior) so future fields on
 * The Information's component contract don't break extraction. */
const ArticleJson = z.object({
	article: z
		.object({
			title: z.string().optional(),
			freeBlurb: z.string().optional(),
			pictureCaption: z.string().optional(),
		})
		.optional(),
});

const PAYWALL_NOTICE =
	"This is the publicly available preview from The Information. The full article requires a subscription. Try to open the full article using a browser extension and save it from there.";

/* Pre-parser for The Information.
 *
 * Article bodies on theinformation.com are paywalled — the public DOM
 * contains only navigation and a "Subscribe to unlock" stub. The publicly
 * visible preview is embedded in a `<script data-component-name="Article">`
 * JSON island. This pre-parser reads that JSON and returns the preview as
 * structured content. The parser then decides how to render it (today:
 * wraps it in a synthetic Document for Readability).
 *
 * Returns `undefined` when the expected JSON island is missing/empty/
 * malformed so the parser falls back to its default extraction. */
export const theInformationPreParser: SitePreParser = {
	matches: ({ hostname }) => HOSTS.has(hostname),
	extract: ({ html }): SiteArticleContent | undefined => {
		const { document } = parseHTML(html);
		const script = document.querySelector('script[data-component-name="Article"]');
		const text = script?.textContent;
		if (!text) return undefined;

		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			return undefined;
		}

		const parsed = ArticleJson.safeParse(raw);
		if (!parsed.success) return undefined;
		const article = parsed.data.article;
		const freeBlurb = article?.freeBlurb;
		if (!freeBlurb) return undefined;

		// Assemble bodyHtml via DOM manipulation so text fields are safely escaped.
		const container = document.createElement("div");

		if (article.pictureCaption) {
			const caption = document.createElement("p");
			caption.textContent = article.pictureCaption;
			container.appendChild(caption);
		}

		const blurbWrapper = document.createElement("div");
		blurbWrapper.innerHTML = freeBlurb;
		while (blurbWrapper.firstChild) container.appendChild(blurbWrapper.firstChild);

		const notice = document.createElement("p");
		const em = document.createElement("em");
		em.textContent = PAYWALL_NOTICE;
		notice.appendChild(em);
		container.appendChild(notice);

		return {
			title: article.title,
			bodyHtml: container.innerHTML,
		};
	},
};
