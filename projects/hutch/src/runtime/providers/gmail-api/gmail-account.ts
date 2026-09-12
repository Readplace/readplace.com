import { z } from "zod";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import type { FindGmailAccountEmail } from "@packages/provider-contracts/gmail-account";
import { classify } from "./gmail-call";

const SEND_AS_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs";

const SendAsListResponse = z.object({
	sendAs: z
		.array(
			z.object({
				sendAsEmail: z.string().trim().toLowerCase().pipe(GmailAccountEmailSchema),
				isPrimary: z.boolean().optional(),
			}),
		)
		.optional(),
});

export function initGmailAccountEmail(deps: {
	fetch: typeof globalThis.fetch;
}): FindGmailAccountEmail {
	return async ({ accessToken }) => {
		const response = await deps.fetch(SEND_AS_ENDPOINT, {
			method: "GET",
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (response.status === 401) return { ok: false, reason: "reauth-required" };
		return classify(
			{ ok: true, value: response },
			async (response) => {
				const parsed = SendAsListResponse.safeParse(await response.json());
				const primary = parsed.success
					? parsed.data.sendAs?.find((alias) => alias.isPrimary === true)
					: undefined;
				if (primary === undefined) {
					return {
						ok: false,
						reason: "rejected",
						status: response.status,
						message: "no primary sendAs address",
					};
				}
				return { ok: true, value: primary.sendAsEmail };
			},
		);
	};
}
