import assert from "node:assert";
import { parseHttpUrl } from "@packages/domain";
import { noRecovery, noTransform, skipCrawl } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";

export const slideshareSiteRules = {
	matches: ({ hostname }) => hostname === "www.slideshare.net" || hostname === "slideshare.net",
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	transform: noTransform,
	extract: ({ html }) => {
		const { document } = parseHTML(html);
		const canonical = document.querySelector('link[rel="canonical"][href]');
		if (!canonical) return undefined;
		const canonicalHref = canonical.getAttribute("href");
		assert(canonicalHref !== null, "canonical links are selected by href");
		const sourceUrl = parseHttpUrl(canonicalHref);
		if (!sourceUrl) return undefined;
		const title = document.querySelector("h1");
		const transcript = document.querySelector(".transcript");
		const images = Array.from(document.querySelectorAll("#main .player .slide-item img"));
		if (!title || !normalizedText(title) || !transcript || images.length === 0) return undefined;
		if (!hasCompletedTranscript({ transcript, document })) return undefined;
		const captions = Array.from(transcript.querySelectorAll("li"));
		if (captions.length === 0) return undefined;
		const body = document.createElement("section");
		const description = document.querySelector('.description [data-cy="document-description"]');
		if (description) {
			const paragraph = document.createElement("p");
			const textNodes = document.createTreeWalker(description, 4);
			let node = textNodes.nextNode();
			while (node) {
				const parent = node.parentElement;
				assert(parent, "description text nodes have a parent element");
				if (!parent.closest("button, script, style")) {
					const text = document.createTextNode(String(node.textContent));
					const href = parent.closest("a[href]")?.getAttribute("href");
					if (href) {
						const link = document.createElement("a");
						link.setAttribute("href", href);
						link.append(text);
						paragraph.append(link);
					} else {
						paragraph.append(text);
					}
				}
				node = textNodes.nextNode();
			}
			body.append(paragraph);
		}
		const list = document.createElement("ul");
		for (const caption of captions) {
			const item = document.createElement("li");
			const sourceLink = caption.querySelector("a[href]");
			if (!sourceLink) return undefined;
			const text = normalizedText(caption);
			const heading = normalizedText(sourceLink);
			const position = text.indexOf(heading);
			if (!heading) return undefined;
			assert(position >= 0, "normalized caption text includes its heading");
			const href = sourceLink.getAttribute("href");
			assert(href !== null, "caption links are selected by href");
			const link = document.createElement("a");
			link.setAttribute("href", new URL(href, sourceUrl).href);
			link.textContent = heading;
			item.append(document.createTextNode(text.slice(0, position)));
			item.append(link);
			item.append(document.createTextNode(text.slice(position + heading.length)));
			list.append(item);
		}
		body.append(list);
		for (const image of images) {
			const src = image.getAttribute("src");
			if (!src) return undefined;
			const figure = document.createElement("figure");
			const safeImage = document.createElement("img");
			safeImage.setAttribute("src", src);
			const alt = image.getAttribute("alt");
			if (alt !== null) safeImage.setAttribute("alt", alt);
			figure.append(safeImage);
			body.append(figure);
		}
		return { title: normalizedText(title), bodyHtml: body.innerHTML };
	},
} satisfies SiteRules;

function normalizedText(element: Element): string {
	return String(element.textContent).replace(/\s+/g, " ").trim();
}

function hasCompletedTranscript(params: { transcript: Element; document: Document }): boolean {
	const carrier = params.transcript.closest("[hidden]");
	if (!carrier) return true;
	const segment = /^S:(\d+)$/.exec(carrier.id);
	if (!segment) return false;
	const boundary = `B:${segment[1]}`;
	if (!params.document.querySelector(`template[id="${boundary}"]`)) return false;
	const completion = `$RC("${boundary}","${carrier.id}")`;
	return Array.from(params.document.querySelectorAll("script")).some((script) => String(script.textContent).includes(completion));
}
