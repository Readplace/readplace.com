import assert from "node:assert";
import { parseHTML } from "linkedom";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { classifyMediaType } from "./media-type";
import { ALLOWED_PROTOCOLS } from "./meta-refresh";

export type TrackerPage = { response: Response; buffer: Buffer; documentUrl: string };

export function fallbackLinkTarget(page: TrackerPage): string | undefined {
	const { response, buffer, documentUrl } = page;
	if (response.status !== 200) return undefined;
	if (buffer.byteLength > MAX_HTML_BYTES.bytes) return undefined;
	if (classifyMediaType({ contentType: response.headers.get("content-type") ?? "", buffer }) !== "html") return undefined;
	const { document } = parseHTML(new TextDecoder().decode(buffer));
	const links = [...document.querySelectorAll("a[href]")];
	if (links.length !== 1) return undefined;
	const href = links[0].getAttribute("href");
	assert(href !== null, "a[href] matched an anchor without an href");
	const target = URL.parse(href, documentUrl);
	if (target === null) return undefined;
	if (!ALLOWED_PROTOCOLS.has(target.protocol)) return undefined;
	if (target.hostname !== new URL(documentUrl).hostname) return undefined;
	return target.href;
}
