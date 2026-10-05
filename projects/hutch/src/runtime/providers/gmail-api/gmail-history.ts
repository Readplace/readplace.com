import { z } from "zod";
import { GMAIL_HISTORY_IMPORT_PAGE_SIZE, GmailMessageIdSchema } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type {
	GetGmailReadonlyAccessToken,
	GmailHistory,
	GmailHistoryResult,
	GmailHttpEndpoint,
	GmailHttpRequestSettings,
	ObserveGmailHttpAttempt,
} from "@packages/provider-contracts/gmail-history";
import { classifyWith, GmailErrorResponse, rejectionFrom } from "./gmail-call";
import {
	GMAIL_API_ORIGIN,
	items,
	jsonOf,
	member,
	type ObservedBodyRead,
	type ObservedResponse,
	observedFetch,
	present,
	readJsonBody,
	type SummarizeBody,
} from "./gmail-http-evidence";

const ENDPOINT = `${GMAIL_API_ORIGIN}/gmail/v1/users/me`;

const LISTING_FIELDS = "messages(id),nextPageToken";
const LISTING_INCLUDES_SPAM_TRASH = false;
const RAW_MESSAGE_FORMAT = "RAW";
const RAW_MESSAGE_FIELDS = "raw,internalDate,labelIds";

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

function listingFields(json: unknown): Record<string, number | boolean> {
	const messages = member(json, "messages");
	return {
		messagesPresent: messages !== undefined,
		messageCount: items(messages).length,
		nextPageTokenPresent: present(json, "nextPageToken"),
	};
}

function rawMessageFields(json: unknown): Record<string, number | boolean> {
	const raw = member(json, "raw");
	return {
		rawPresent: raw !== undefined,
		rawLength: typeof raw === "string" ? raw.length : 0,
		internalDatePresent: present(json, "internalDate"),
		labelCount: items(member(json, "labelIds")).length,
	};
}

function errorFields(json: unknown): Record<string, number | boolean> {
	const error = member(json, "error");
	const reasons = [...items(member(error, "errors")), ...items(member(error, "details"))]
		.map((entry) => member(entry, "reason"))
		.filter((reason) => typeof reason === "string");
	return {
		errorPresent: error !== undefined,
		errorReasonCount: reasons.length,
		rateLimitReason: reasons.some((reason) => RATE_LIMITED.has(reason)),
		scopeReason: reasons.some((reason) => SCOPE_MISSING.has(reason)),
		messagePresent: present(error, "message"),
	};
}

async function readParsed<TSchema extends z.ZodType>(input: {
	response: Response;
	source: ObservedBodyRead["source"];
	schema: TSchema;
	summarize: SummarizeBody;
	bodyReads: ObservedBodyRead[];
}): Promise<z.ZodSafeParseResult<z.output<TSchema>>> {
	const body = await readJsonBody(input.response);
	const parsed = input.schema.safeParse(jsonOf(body));
	input.bodyReads.push({ source: input.source, body, accepted: parsed.success, summarize: input.summarize });
	return parsed;
}

async function forbiddenReasons(input: { response: Response; bodyReads: ObservedBodyRead[] }): Promise<string[]> {
	const parsed = await readParsed({
		response: input.response.clone(),
		source: "clone",
		schema: ErrorResponse,
		summarize: errorFields,
		bodyReads: input.bodyReads,
	});
	if (!parsed.success) return [];
	return [
		...(parsed.data.error.errors ?? []).map((error) => error.reason),
		...(parsed.data.error.details ?? []).map((detail) => detail.reason).filter((reason) => reason !== undefined),
	];
}

function parsed<TSchema extends z.ZodType>(input: {
	schema: TSchema;
	summarize: SummarizeBody;
	bodyReads: ObservedBodyRead[];
}): (response: Response) => Promise<GmailApiResult<z.output<TSchema>>> {
	return async (response) => {
		const body = await readParsed({ response, source: "response", ...input });
		return body.success ? { ok: true, value: body.data } : { ok: false, reason: "unavailable", status: response.status };
	};
}

async function interpret<TSchema extends z.ZodType>(input: {
	response: Response;
	schema: TSchema;
	summarize: SummarizeBody;
	bodyReads: ObservedBodyRead[];
}): Promise<GmailHistoryResult<z.output<TSchema>>> {
	const { response, bodyReads } = input;
	if (response.status === 403) {
		const reasons = await forbiddenReasons({ response, bodyReads });
		if (reasons.some((reason) => RATE_LIMITED.has(reason))) {
			return { ok: false, reason: "unavailable", status: response.status };
		}
		if (reasons.some((reason) => SCOPE_MISSING.has(reason))) {
			return { ok: false, reason: "readonly-permission-required" };
		}
	}
	return classifyWith(
		{ ok: true, value: response },
		{
			onOk: parsed({ schema: input.schema, summarize: input.summarize, bodyReads }),
			onRefused: async (refused) =>
				rejectionFrom({
					response: refused,
					body: await readParsed({
						response: refused,
						source: "response",
						schema: GmailErrorResponse,
						summarize: errorFields,
						bodyReads,
					}),
				}),
		},
	);
}

async function read<TSchema extends z.ZodType>(input: {
	call: GmailHistoryResult<ObservedResponse>;
	schema: TSchema;
	summarize: SummarizeBody;
}): Promise<GmailHistoryResult<z.output<TSchema>>> {
	if (!input.call.ok) return input.call;
	const { response, settle } = input.call.value;
	const bodyReads: ObservedBodyRead[] = [];
	const result = await interpret({ response, schema: input.schema, summarize: input.summarize, bodyReads });
	settle({ classification: result.ok ? "ok" : result.reason, bodyReads });
	return result;
}

export function initGmailHistory(deps: {
	accessToken: GetGmailReadonlyAccessToken;
	fetch: typeof globalThis.fetch;
	now: () => Date;
}): GmailHistory {
	async function get(input: {
		userId: UserId;
		url: string;
		request: GmailHttpRequestSettings;
		requestedEndpoint: GmailHttpEndpoint;
		observe: ObserveGmailHttpAttempt;
	}): Promise<GmailHistoryResult<ObservedResponse>> {
		async function attempt(retry: { forceRefresh: boolean; attempt: number }): Promise<GmailHistoryResult<ObservedResponse>> {
			const token = await deps.accessToken({ userId: input.userId, forceRefresh: retry.forceRefresh, observe: input.observe });
			if (!token.ok) return token;
			const observed = await observedFetch({
				fetch: deps.fetch,
				now: deps.now,
				url: input.url,
				init: {
					method: "GET",
					headers: { Authorization: `Bearer ${token.value}` },
				},
				target: {
					request: input.request,
					attempt: retry.attempt,
					requestedEndpoint: input.requestedEndpoint,
					expectedOrigin: GMAIL_API_ORIGIN,
				},
				observe: input.observe,
			});
			return { ok: true, value: observed };
		}

		const first = await attempt({ forceRefresh: false, attempt: 1 });
		if (!first.ok || first.value.response.status !== 401) return first;
		first.value.settle({ classification: "token-refresh-retry", bodyReads: [] });
		const second = await attempt({ forceRefresh: true, attempt: 2 });
		if (second.ok && second.value.response.status === 401) {
			second.value.settle({ classification: "reauth-required", bodyReads: [] });
			return { ok: false, reason: "reauth-required" };
		}
		return second;
	}

	return {
		listUnreadMessageIds: async ({ userId, sender, window, pageToken, observe }) => {
			const query = new URLSearchParams({
				q: `from:${sender} is:unread after:${epochSeconds(window.start)} before:${epochSeconds(window.end)}`,
				maxResults: String(GMAIL_HISTORY_IMPORT_PAGE_SIZE),
				includeSpamTrash: String(LISTING_INCLUDES_SPAM_TRASH),
				fields: LISTING_FIELDS,
			});
			if (pageToken !== undefined) query.set("pageToken", pageToken);
			const call = await get({
				userId,
				url: `${ENDPOINT}/messages?${query}`,
				request: {
					operation: "messages.list",
					fieldMask: LISTING_FIELDS,
					pageSize: GMAIL_HISTORY_IMPORT_PAGE_SIZE,
					includeSpamTrash: LISTING_INCLUDES_SPAM_TRASH,
					pageTokenPresent: pageToken !== undefined,
				},
				requestedEndpoint: "gmail.messages.list",
				observe,
			});
			const result = await read({ call, schema: MessagesResponse, summarize: listingFields });
			if (!result.ok) return result;
			return {
				ok: true,
				value: {
					messageIds: (result.value.messages ?? []).map((message) => message.id),
					nextPageToken: result.value.nextPageToken,
				},
			};
		},
		fetchRawMessage: async ({ userId, messageId, observe }) => {
			const query = new URLSearchParams({ format: RAW_MESSAGE_FORMAT, fields: RAW_MESSAGE_FIELDS });
			const call = await get({
				userId,
				url: `${ENDPOINT}/messages/${encodeURIComponent(messageId)}?${query}`,
				request: { operation: "messages.get", fieldMask: RAW_MESSAGE_FIELDS, format: RAW_MESSAGE_FORMAT },
				requestedEndpoint: "gmail.messages.get",
				observe,
			});
			if (call.ok && call.value.response.status === 404) {
				call.value.settle({ classification: "not-found", bodyReads: [] });
				return { ok: true, value: { notFound: true } };
			}
			const result = await read({ call, schema: RawMessageResponse, summarize: rawMessageFields });
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
