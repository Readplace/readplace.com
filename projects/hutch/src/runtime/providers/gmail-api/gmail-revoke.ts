import type { RevokeGmailGrant } from "@packages/provider-contracts/gmail-oauth";

const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export function initRevokeGmailGrant(deps: {
	fetch: typeof globalThis.fetch;
}): RevokeGmailGrant {
	return async ({ refreshToken }) => {
		const response = await deps.fetch(REVOKE_ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ token: refreshToken }).toString(),
		});
		if (response.ok || response.status === 400) return { ok: true };
		return { ok: false, reason: "unavailable", status: response.status };
	};
}
