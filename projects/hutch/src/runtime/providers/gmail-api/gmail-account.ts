import { z } from "zod";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import type { FindGmailAccountEmail } from "@packages/provider-contracts/gmail-account";
import type { GetGmailAccessToken } from "@packages/provider-contracts/gmail-filters";
import { classify, initCallGmail } from "./gmail-call";

const SEND_AS_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs";

const SendAsListResponse = z.object({
	sendAs: z
		.array(
			z.object({
				sendAsEmail: GmailAccountEmailSchema,
				isPrimary: z.boolean().optional(),
			}),
		)
		.optional(),
});

export function initGmailAccountEmail(deps: {
	accessToken: GetGmailAccessToken;
	fetch: typeof globalThis.fetch;
}): FindGmailAccountEmail {
	const callGmail = initCallGmail(deps);

	return async ({ userId }) =>
		classify(
			await callGmail(userId, { url: SEND_AS_ENDPOINT, method: "GET" }),
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
}
