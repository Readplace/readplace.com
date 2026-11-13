export function unwrapArticleBodyTemplates(document: Document): void {
	for (const template of Array.from(document.querySelectorAll('[itemprop="articleBody"] script[type="text/template"]'))) {
		const markup = document.createElement("div");
		markup.innerHTML = template.textContent;
		template.replaceWith(...Array.from(markup.childNodes));
	}
}
