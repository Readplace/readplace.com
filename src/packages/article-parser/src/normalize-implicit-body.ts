export function normalizeImplicitBody(document: Document): void {
	promoteEdgarFiling(document);
	wrapInHtmlRoot(document);
	const head = document.head;
	const body = document.body;
	const METADATA_TAGS = new Set([
		"META",
		"LINK",
		"TITLE",
		"STYLE",
		"SCRIPT",
		"BASE",
	]);
	for (const child of Array.from(head.children)) {
		if (!METADATA_TAGS.has(child.tagName)) body.appendChild(child);
	}
	for (const child of Array.from(document.documentElement.children)) {
		if (child === head || child === body) continue;
		if (METADATA_TAGS.has(child.tagName)) head.appendChild(child);
		else body.appendChild(child);
	}
}

function wrapInHtmlRoot(document: Document): void {
	if (document.documentElement.tagName === "HTML" && document.children.length === 1) return;
	const html =
		Array.from(document.children).find((child) => child.tagName === "HTML") ??
		document.createElement("html");
	document.insertBefore(html, document.documentElement);
	for (const node of Array.from(document.childNodes)) {
		if (node !== html && node.nodeType !== node.DOCUMENT_TYPE_NODE) html.appendChild(node);
	}
}

function promoteEdgarFiling(document: Document): void {
	if (document.documentElement.tagName !== "DOCUMENT") return;
	const filing = document.documentElement.querySelector("TEXT > html");
	if (!filing) return;
	document.replaceChild(filing, document.documentElement);
	for (const sibling of Array.from(document.children)) {
		if (sibling !== filing) sibling.remove();
	}
}
