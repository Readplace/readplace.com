import { parseHTML } from "linkedom";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { classifyMediaType } from "./media-type";

const REFRESH_DECLARATION = /^\s*[\d.]+(?:\s*[;,]\s*|\s+)url\s*=\s*(.+)$/is;
const LEADING_QUOTE = /^['"]/;
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:"]);

function attributeValue(element: { attributes: Iterable<{ name: string; value: string }> }, name: string): string {
	const attribute = [...element.attributes].find((candidate) => candidate.name.toLowerCase() === name);
	return attribute === undefined ? "" : attribute.value;
}

export function metaRefreshTarget(page: { response: Response; buffer: Buffer; documentUrl: string }): string | undefined {
	const { response, buffer, documentUrl } = page;
	if (!response.ok) return undefined;
	if (buffer.byteLength > MAX_HTML_BYTES.bytes) return undefined;
	if (classifyMediaType({ contentType: response.headers.get("content-type") ?? "", buffer }) !== "html") return undefined;
	const { document } = parseHTML(new TextDecoder().decode(buffer));
	const refresh = [...document.querySelectorAll("meta")].find((meta) => attributeValue(meta, "http-equiv").toLowerCase() === "refresh");
	if (refresh === undefined) return undefined;
	const declared = REFRESH_DECLARATION.exec(attributeValue(refresh, "content"))?.[1];
	if (declared === undefined) return undefined;
	const quote = LEADING_QUOTE.exec(declared)?.[0];
	const target = URL.parse(quote === undefined ? declared : declared.slice(1).split(quote)[0], documentUrl);
	if (target === null) return undefined;
	if (!ALLOWED_PROTOCOLS.has(target.protocol)) return undefined;
	for (const hidden of document.querySelectorAll("title, script")) {
		hidden.remove();
	}
	if ([...document.childNodes].map((node) => node.textContent).join("").trim() !== "") return undefined;
	return target.href;
}
