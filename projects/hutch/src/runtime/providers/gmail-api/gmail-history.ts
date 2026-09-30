import { z } from "zod";
import { GMAIL_HISTORY_IMPORT_PAGE_SIZE, GmailMessageIdSchema } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type {
	GetGmailReadonlyAccessToken,
	GmailHistory,
	GmailHistoryResult,
} from "@packages/provider-contracts/gmail-history";
import { classify } from "./gmail-call";

const ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me";

const MessagesResponse = z.object({
	messages: z.array(z.object({ id: GmailMessageIdSchema })).optional(),
	nextPageToken: z.string().optional(),
});

const RawMessageResponse = z.object({
	raw: z.string(),
	internalDate: z.coerce.number().int(),
	labelIds: z.array(z.string()).optional(),
});

const ErrorResponse = z.object({
	error: z.object({
		errors: z.array(z.object({ reason: z.string() })).optional(),
		details: z.array(z.object({ reason: z.string().optional() })).optional(),
	}),
});

const RATE_LIMITED = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
const SCOPE_MISSING = new Set(["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"]);

function epochSeconds(iso: string): number {
	return Math.floor(new Date(iso).getTime() / 1000);
}

async function forbiddenReasons(response: Response): Promise<string[]> {
	const parsed = ErrorResponse.safeParse(await response.clone().json().catch(() => undefined));
	if (!parsed.success) return [];
	return [
		...(parsed.data.error.errors ?? []).map((error) => error.reason),
		...(parsed.data.error.details ?? []).map((detail) => detail.reason).filter((reason) => reason !== undefined),
	];
}

function parsed<TSchema extends z.ZodType>(
	schema: TSchema,
): (response: Response) => Promise<GmailApiResult<z.output<TSchema>>> {
	return async (response) => {
		const body = schema.safeParse(await response.json().catch(() => undefined));
		return body.success ? { ok: true, value: body.data } : { ok: false, reason: "unavailable", status: response.status };
	};
}

export function initGmailHistory(deps: {
	accessToken: GetGmailReadonlyAccessToken;
	fetch: typeof globalThis.fetch;
}): GmailHistory {
	async function get(userId: UserId, url: string): Promise<GmailHistoryResult<Response>> {
		async function attempt(forceRefresh: boolean): Promise<GmailHistoryResult<Response>> {
			const token = await deps.accessToken({ userId, forceRefresh });
			if (!token.ok) return token;
			const response = await deps.fetch(url, {
				method: "GET",
				headers: { Authorization: `Bearer ${token.value}` },
			});
			return { ok: true, value: response };
		}

		const first = await attempt(false);
		if (!first.ok || first.value.status !== 401) return first;
		const second = await attempt(true);
		if (second.ok && second.value.status === 401) return { ok: false, reason: "reauth-required" };
		return second;
	}

	async function read<TSchema extends z.ZodType>(
		call: GmailHistoryResult<Response>,
		schema: TSchema,
	): Promise<GmailHistoryResult<z.output<TSchema>>> {
		if (!call.ok) return call;
		if (call.value.status === 403) {
			const reasons = await forbiddenReasons(call.value);
			if (reasons.some((reason) => RATE_LIMITED.has(reason))) {
				return { ok: false, reason: "unavailable", status: call.value.status };
			}
			if (reasons.some((reason) => SCOPE_MISSING.has(reason))) {
				return { ok: false, reason: "readonly-permission-required" };
			}
		}
		return classify(call, parsed(schema));
	}

	return {
		listUnreadMessageIds: async ({ userId, sender, window, pageToken }) => {
			const query = new URLSearchParams({
				q: `from:${sender} is:unread after:${epochSeconds(window.start)} before:${epochSeconds(window.end)}`,
				maxResults: String(GMAIL_HISTORY_IMPORT_PAGE_SIZE),
				includeSpamTrash: "false",
				fields: "messages(id),nextPageToken",
			});
			if (pageToken !== undefined) query.set("pageToken", pageToken);
			const result = await read(await get(userId, `${ENDPOINT}/messages?${query}`), MessagesResponse);
			if (!result.ok) return result;
			return {
				ok: true,
				value: {
					messageIds: (result.value.messages ?? []).map((message) => message.id),
					nextPageToken: result.value.nextPageToken,
				},
			};
		},
		fetchRawMessage: async ({ userId, messageId }) => {
			const query = new URLSearchParams({ format: "RAW", fields: "raw,internalDate,labelIds" });
			const call = await get(userId, `${ENDPOINT}/messages/${encodeURIComponent(messageId)}?${query}`);
			if (call.ok && call.value.status === 404) return { ok: true, value: { notFound: true } };
			const result = await read(call, RawMessageResponse);
			if (!result.ok) return result;
			return {
				ok: true,
				value: {
					raw: Buffer.from(result.value.raw, "base64url"),
					internalDate: new Date(result.value.internalDate).toISOString(),
					labelIds: result.value.labelIds ?? [],
				},
			};
		},
	};
}
