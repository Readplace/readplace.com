import { parseHttpUrl } from "@packages/domain/inbox";
import { parseHTML } from "linkedom";

const CONFIRMATION_ORIGIN = "https://mail.google.com";
const CONFIRMATION_PATH_PREFIX = "/mail/vf-";

export type ConfirmForwardingAddressResult =
	| { ok: true }
	| { ok: false; reason: "invalid-url" }
	| { ok: false; reason: "token-rejected"; status: number }
	| { ok: false; reason: "not-confirmed" }
	| { ok: false; reason: "unavailable"; status: number };

export type ConfirmForwardingAddress = (input: {
	verifyUrl: string;
}) => Promise<ConfirmForwardingAddressResult>;

export function initConfirmForwardingAddress(deps: {
	fetch: typeof globalThis.fetch;
	timeoutMs: number;
}): ConfirmForwardingAddress {
	return async ({ verifyUrl }) => {
		const url = parseHttpUrl(verifyUrl);
		if (
			url === undefined ||
			url.origin !== CONFIRMATION_ORIGIN ||
			!url.pathname.startsWith(CONFIRMATION_PATH_PREFIX)
		) {
			return { ok: false, reason: "invalid-url" };
		}
		const response = await deps.fetch(url.toString(), {
			method: "POST",
			signal: AbortSignal.timeout(deps.timeoutMs),
		});
		if (response.status === 400) return { ok: false, reason: "token-rejected", status: 400 };
		if (response.status !== 200) return { ok: false, reason: "unavailable", status: response.status };
		const { document } = parseHTML(await response.text());
		if (document.querySelector('form input[type="submit"]') !== null) {
			return { ok: false, reason: "not-confirmed" };
		}
		return { ok: true };
	};
}
