import assert from "node:assert";
import { ALLOWED_PROTOCOLS } from "./follow-redirects";
import { htmlDocumentOf } from "./meta-refresh";

export type TrackerPage = { response: Response; buffer: Buffer; documentUrl: string };

export function fallbackLinkTarget(page: TrackerPage): string | undefined {
	const { response, buffer, documentUrl } = page;
	if (response.status !== 200) return undefined;
	const document = htmlDocumentOf({ response, buffer });
	if (document === undefined) return undefined;
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
