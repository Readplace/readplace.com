import { z } from "zod";
import { type GmailCredentialsStore, GmailMessageIdSchema, hasGmailScope, sameGmailAccount } from "@packages/domain/gmail";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type { GmailMessageCandidate, OpenedGmailMailbox, OpenGmailMailboxForUpdate } from "@packages/provider-contracts/gmail-message-update";
import { GMAIL_MODIFY_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { readGoogleTokenError } from "../gmail-oauth/google-token-error";
import { classify } from "./gmail-call";
import { GMAIL_API_ORIGIN, GOOGLE_OAUTH_ORIGIN } from "./gmail-http-evidence";

const USER_ENDPOINT = `${GMAIL_API_ORIGIN}/gmail/v1/users/me`;
const SEARCH_PAGE_SIZE = 10;
const UNPARSEABLE = { ok: false, reason: "unavailable" } as const;

const TokenResponse = z.object({ access_token: z.string() });
const ProfileResponse = z.object({ emailAddress: z.string() });
const MessageIdsResponse = z.object({ messages: z.array(z.object({ id: GmailMessageIdSchema })).optional() });
const MessageHeadersResponse = z.object({
	id: GmailMessageIdSchema,
	payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).optional() }).optional(),
});
const LabelsResponse = z.object({ labels: z.array(z.object({ id: z.string(), name: z.string() })).optional() });
const LabelResponse = z.object({ id: z.string() });

function headerValue(message: z.infer<typeof MessageHeadersResponse>, name: string): string | undefined {
	return message.payload?.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

async function parsed<TSchema extends z.ZodType>(response: Response, schema: TSchema): Promise<GmailApiResult<z.output<TSchema>>> {
	const body = schema.safeParse(await response.json().catch(() => undefined));
	return body.success ? { ok: true, value: body.data } : { ...UNPARSEABLE, status: response.status };
}

export function initOpenGmailMailboxForUpdate(deps: {
	clientId: string;
	clientSecret: string;
	credentials: Pick<GmailCredentialsStore, "findCredentialsByUserId">;
	fetch: typeof globalThis.fetch;
}): OpenGmailMailboxForUpdate {
	return async ({ userId, accountEmail }) => {
		const credentials = await deps.credentials.findCredentialsByUserId(userId);
		if (credentials === undefined) return { ok: false, reason: "not-connected" };
		if (!hasGmailScope({ grantedScope: credentials.grantedScope, scope: GMAIL_MODIFY_SCOPE })) {
			return { ok: false, reason: "modify-permission-required" };
		}

		const token = await deps.fetch(`${GOOGLE_OAUTH_ORIGIN}/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: deps.clientId,
				client_secret: deps.clientSecret,
				refresh_token: credentials.refreshToken,
				grant_type: "refresh_token",
			}).toString(),
		});
		const tokenBody: unknown = await token.json().catch(() => undefined);
		if (readGoogleTokenError(tokenBody).error === "invalid_grant") return { ok: false, reason: "reauth-required" };
		const accessToken = TokenResponse.safeParse(tokenBody);
		if (!token.ok || !accessToken.success) return { ok: false, reason: "unavailable", status: token.status };

		const call = async (url: string, init: { method: string; body?: unknown } = { method: "GET" }): Promise<GmailApiResult<Response>> => {
			const response = await deps.fetch(url, {
				method: init.method,
				headers: {
					Authorization: `Bearer ${accessToken.data.access_token}`,
					...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
				},
				...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
			});
			return response.status === 401 ? { ok: false, reason: "reauth-required" } : { ok: true, value: response };
		};

		const profile = await classify(await call(`${USER_ENDPOINT}/profile?fields=emailAddress`), (response) => parsed(response, ProfileResponse));
		if (!profile.ok) {
			if (profile.reason === "reauth-required") return { ok: false, reason: "reauth-required" };
			return { ok: false, reason: "unavailable", status: profile.status };
		}
		if (!sameGmailAccount(profile.value.emailAddress, accountEmail)) return { ok: false, reason: "account-mismatch" };

		const readHeaders = async (id: z.infer<typeof GmailMessageIdSchema>): Promise<GmailApiResult<GmailMessageCandidate>> => {
			const query = new URLSearchParams({ format: "metadata", fields: "id,payload/headers" });
			query.append("metadataHeaders", "Message-ID");
			query.append("metadataHeaders", "From");
			const message = await classify(await call(`${USER_ENDPOINT}/messages/${encodeURIComponent(id)}?${query}`), (response) =>
				parsed(response, MessageHeadersResponse),
			);
			if (!message.ok) return message;
			return { ok: true, value: { id, messageIdHeader: headerValue(message.value, "Message-ID"), fromHeader: headerValue(message.value, "From") } };
		};

		const findLabelId: OpenedGmailMailbox["findLabelId"] = async ({ name }) => {
			const labels = await classify(await call(`${USER_ENDPOINT}/labels?fields=labels(id,name)`), (response) => parsed(response, LabelsResponse));
			if (!labels.ok) return labels;
			return { ok: true, value: labels.value.labels?.find((label) => label.name === name)?.id };
		};

		const mailbox: OpenedGmailMailbox = {
			findMessage: async ({ messageId }) => {
				const found = await call(`${USER_ENDPOINT}/messages/${encodeURIComponent(messageId)}?format=minimal&fields=id`);
				if (found.ok && found.value.status === 404) return { ok: true, value: { found: false } };
				return classify(found, async () => ({ ok: true, value: { found: true } }));
			},
			searchByRfcMessageId: async ({ rfcMessageId, senderEmail }) => {
				const query = new URLSearchParams({
					q: `rfc822msgid:${rfcMessageId} from:${senderEmail}`,
					includeSpamTrash: "false",
					maxResults: String(SEARCH_PAGE_SIZE),
					fields: "messages(id)",
				});
				const listed = await classify(await call(`${USER_ENDPOINT}/messages?${query}`), (response) => parsed(response, MessageIdsResponse));
				if (!listed.ok) return listed;
				const candidates: GmailMessageCandidate[] = [];
				for (const { id } of listed.value.messages ?? []) {
					const candidate = await readHeaders(id);
					if (!candidate.ok) return candidate;
					candidates.push(candidate.value);
				}
				return { ok: true, value: candidates };
			},
			findLabelId,
			createLabel: async ({ name }) => {
				const created = await call(`${USER_ENDPOINT}/labels`, {
					method: "POST",
					body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
				});
				if (created.ok && created.value.status === 409) return { ok: true, value: { conflict: true } };
				const label = await classify(created, (response) => parsed(response, LabelResponse));
				return label.ok ? { ok: true, value: { created: label.value.id } } : label;
			},
			modifyMessage: async ({ messageId, addLabelIds, removeLabelIds }) =>
				classify(
					await call(`${USER_ENDPOINT}/messages/${encodeURIComponent(messageId)}/modify`, {
						method: "POST",
						body: { addLabelIds, removeLabelIds },
					}),
					async () => ({ ok: true, value: undefined }),
				),
		};
		return { ok: true, mailbox };
	};
}
