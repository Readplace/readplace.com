import { z } from "zod";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import type { FindGmailAccountEmail } from "@packages/provider-contracts/gmail-account";
import { classify } from "./gmail-call";

const PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress";

const ProfileResponse = z.object({
	emailAddress: z.string().trim().toLowerCase().pipe(GmailAccountEmailSchema),
});

export function initGmailAccountEmail(deps: {
	fetch: typeof globalThis.fetch;
}): FindGmailAccountEmail {
	return async ({ accessToken }) => {
		const response = await deps.fetch(PROFILE_ENDPOINT, {
			method: "GET",
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (response.status === 401) return { ok: false, reason: "reauth-required" };
		return classify(
			{ ok: true, value: response },
			async (response) => {
				const parsed = ProfileResponse.safeParse(await response.json());
				if (!parsed.success) {
					return {
						ok: false,
						reason: "rejected",
						status: response.status,
						message: "profile has no emailAddress",
					};
				}
				return { ok: true, value: parsed.data.emailAddress };
			},
		);
	};
}
