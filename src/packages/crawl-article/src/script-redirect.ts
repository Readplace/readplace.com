import { ALLOWED_PROTOCOLS, REDIRECT_STATUS_CODES } from "./follow-redirects";
import { htmlDocumentOf, isTextlessOnceHidden } from "./meta-refresh";

const REDIRECT_URL_ASSIGNMENT = /\bvar\s+redirecturl\s*=\s*(['"])(.*?)\1/;

export function isLocationlessRedirect(response: Response): boolean {
	return REDIRECT_STATUS_CODES.has(response.status) && response.headers.get("location") === null;
}

export function scriptRedirectTarget(page: { response: Response; buffer: Buffer; documentUrl: string }): string | undefined {
	const { response, buffer, documentUrl } = page;
	if (!isLocationlessRedirect(response)) return undefined;
	const document = htmlDocumentOf({ response, buffer });
	if (document === undefined) return undefined;
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
