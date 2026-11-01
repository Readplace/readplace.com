import { parseHTML } from "linkedom";
import { REDIRECT_STATUS_CODES } from "./follow-redirects";
import { MAX_HTML_BYTES } from "./html-body-limit";
import { classifyMediaType } from "./media-type";
import { ALLOWED_PROTOCOLS, isTextlessOnceHidden } from "./meta-refresh";

const REDIRECT_URL_ASSIGNMENT = /\bvar\s+redirecturl\s*=\s*(['"])(.*?)\1/;

export function isLocationlessRedirect(response: Response): boolean {
	return REDIRECT_STATUS_CODES.has(response.status) && response.headers.get("location") === null;
}

export function scriptRedirectTarget(page: { response: Response; buffer: Buffer; documentUrl: string }): string | undefined {
	const { response, buffer, documentUrl } = page;
	if (!isLocationlessRedirect(response)) return undefined;
	if (buffer.byteLength > MAX_HTML_BYTES.bytes) return undefined;
	if (classifyMediaType({ contentType: response.headers.get("content-type") ?? "", buffer }) !== "html") return undefined;
	const { document } = parseHTML(new TextDecoder().decode(buffer));
	const scripts = [...document.querySelectorAll("script")];
	if (scripts.length !== 1) return undefined;
	const declared = REDIRECT_URL_ASSIGNMENT.exec(scripts[0].textContent)?.[2];
	if (declared === undefined) return undefined;
	const target = URL.parse(declared, documentUrl);
	if (target === null) return undefined;
	if (!ALLOWED_PROTOCOLS.has(target.protocol)) return undefined;
	if (!isTextlessOnceHidden(document)) return undefined;
	return target.href;
}
