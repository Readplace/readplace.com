import type {
	GmailHttpAttempt,
	GmailHttpBodyRead,
	GmailHttpClassification,
	GmailHttpEndpoint,
	GmailHttpRequestSettings,
	GmailHttpResponseEvidence,
	GmailHttpResponseHeaders,
	ObserveGmailHttpAttempt,
} from "@packages/provider-contracts/gmail-history";

export const GMAIL_API_ORIGIN = "https://gmail.googleapis.com";
export const GOOGLE_OAUTH_ORIGIN = "https://oauth2.googleapis.com";

const KNOWN_ENDPOINTS: { origin: string; path: RegExp; endpoint: GmailHttpEndpoint }[] = [
	{ origin: GMAIL_API_ORIGIN, path: /^\/gmail\/v1\/users\/me\/messages$/, endpoint: "gmail.messages.list" },
	{ origin: GMAIL_API_ORIGIN, path: /^\/gmail\/v1\/users\/me\/messages\/[^/]+$/, endpoint: "gmail.messages.get" },
	{ origin: GOOGLE_OAUTH_ORIGIN, path: /^\/token$/, endpoint: "oauth.token" },
];

const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/;
const DECLARED_LENGTH = /^\d{1,15}$/;
const CONTENT_ENCODING = /^[a-z0-9, -]{1,64}$/;
const DELAY_SECONDS = /^\d{1,10}$/;
const IMF_FIXDATE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,256}$/;
const CLOUD_TRACE_CONTEXT = /^[0-9a-fA-F]{32}(\/[0-9]{1,20})?(;o=[0-9])?$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

const UTF8_BOM = Uint8Array.of(0xef, 0xbb, 0xbf);

export type SummarizeBody = (json: unknown) => Record<string, number | boolean>;

export type JsonBody =
	| { outcome: "decoded"; json: unknown; measuredBytes: number }
	| { outcome: "json-decode-failed"; error: unknown; measuredBytes: number }
	| { outcome: "body-read-failed"; error: unknown };

export interface ObservedBodyRead {
	source: GmailHttpBodyRead["source"];
	body: JsonBody;
	accepted: boolean;
	summarize: SummarizeBody;
}

export interface ObservedResponse {
	response: Response;
	settle: (outcome: { classification: GmailHttpClassification; bodyReads: ObservedBodyRead[] }) => void;
}

function utf8DecodeBytes(bytes: Uint8Array): string {
	const marked = UTF8_BOM.every((byte, index) => bytes[index] === byte);
	return new TextDecoder().decode(marked ? bytes.subarray(UTF8_BOM.length) : bytes);
}

function decodeJson(bytes: ArrayBuffer): JsonBody {
	try {
		return { outcome: "decoded", json: JSON.parse(utf8DecodeBytes(new Uint8Array(bytes))), measuredBytes: bytes.byteLength };
	} catch (error) {
		return { outcome: "json-decode-failed", error, measuredBytes: bytes.byteLength };
	}
}

export async function readJsonBody(response: Response): Promise<JsonBody> {
	return response.arrayBuffer().then(decodeJson, (error: unknown): JsonBody => ({ outcome: "body-read-failed", error }));
}

export function jsonOf(body: JsonBody): unknown {
	return body.outcome === "decoded" ? body.json : undefined;
}

export function member(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function present(value: unknown, key: string): boolean {
	return member(value, key) !== undefined;
}

export function items(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : "unknown";
}

function errorCode(value: unknown): string | undefined {
	const code = member(value, "code");
	return typeof code === "string" && ERROR_CODE.test(code) ? code : undefined;
}

function valid(value: string | null, pattern: RegExp): string | undefined {
	return value !== null && pattern.test(value) ? value : undefined;
}

function lowercase(value: string | null): string | null {
	return value === null ? null : value.toLowerCase();
}

function mediaType(value: string | null): string | null {
	return value === null ? null : value.split(";")[0].trim().toLowerCase();
}

function httpDate(value: string | null): string | undefined {
	const date = valid(value, IMF_FIXDATE);
	if (date === undefined) return undefined;
	const time = Date.parse(date);
	return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function destination(input: { url: string; expectedOrigin: string }): {
	endpoint: GmailHttpEndpoint;
	originExpected: boolean;
} {
	const url = new URL(input.url);
	if (url.origin !== input.expectedOrigin) return { endpoint: "unexpected-origin", originExpected: false };
	const known = KNOWN_ENDPOINTS.find((candidate) => candidate.origin === url.origin && candidate.path.test(url.pathname));
	return { endpoint: known === undefined ? "other-expected-origin" : known.endpoint, originExpected: true };
}

function responseHeaders(input: { headers: Headers; originExpected: boolean }): GmailHttpResponseHeaders {
	const { headers } = input;
	const declaredContentLength = valid(headers.get("content-length"), DECLARED_LENGTH);
	const providerId = (name: string, pattern: RegExp) =>
		input.originExpected ? valid(headers.get(name), pattern) : undefined;
	return {
		contentType: valid(mediaType(headers.get("content-type")), MEDIA_TYPE),
		declaredContentLength: declaredContentLength === undefined ? undefined : Number(declaredContentLength),
		contentEncoding: valid(lowercase(headers.get("content-encoding")), CONTENT_ENCODING),
		date: httpDate(headers.get("date")),
		retryAfter: valid(headers.get("retry-after"), DELAY_SECONDS) ?? httpDate(headers.get("retry-after")),
		googRequestId: providerId("x-goog-request-id", PROVIDER_ID),
		guploaderUploadId: providerId("x-guploader-uploadid", PROVIDER_ID),
		cloudTraceContext: providerId("x-cloud-trace-context", CLOUD_TRACE_CONTEXT),
	};
}

function bodyReadEvidence(read: ObservedBodyRead): GmailHttpBodyRead {
	const { source, body } = read;
	if (body.outcome === "decoded") {
		return {
			source,
			outcome: read.accepted ? "valid" : "schema-rejected",
			measuredBytes: body.measuredBytes,
			errorName: undefined,
			fields: read.summarize(body.json),
		};
	}
	return {
		source,
		outcome: body.outcome,
		measuredBytes: body.outcome === "json-decode-failed" ? body.measuredBytes : undefined,
		errorName: errorName(body.error),
		fields: {},
	};
}

function responseEvidence(input: {
	response: Response;
	expectedOrigin: string;
	bodyReads: ObservedBodyRead[];
}): GmailHttpResponseEvidence {
	const { response } = input;
	const reached = destination({ url: response.url, expectedOrigin: input.expectedOrigin });
	return {
		status: response.status,
		redirected: response.redirected,
		finalEndpoint: reached.endpoint,
		finalOriginExpected: reached.originExpected,
		bodyNull: response.body === null,
		headers: responseHeaders({ headers: response.headers, originExpected: reached.originExpected }),
		bodyReads: input.bodyReads.map(bodyReadEvidence),
	};
}

function record(input: { observe: ObserveGmailHttpAttempt; describe: () => GmailHttpAttempt }): void {
	try {
		input.observe(input.describe());
	} catch {
		return;
	}
}

export async function observedFetch(input: {
	fetch: typeof globalThis.fetch;
	now: () => Date;
	url: string;
	init: RequestInit;
	target: {
		request: GmailHttpRequestSettings;
		attempt: number;
		requestedEndpoint: GmailHttpEndpoint;
		expectedOrigin: string;
	};
	observe: ObserveGmailHttpAttempt;
}): Promise<ObservedResponse> {
	const { target, observe } = input;
	const attempt = (durationMs: number) => ({
		operation: target.request.operation,
		attempt: target.attempt,
		request: target.request,
		requestedEndpoint: target.requestedEndpoint,
		durationMs,
	});
	const startedAt = input.now().getTime();
	const response = await input.fetch(input.url, input.init).catch((error: unknown) => {
		const durationMs = input.now().getTime() - startedAt;
		record({
			observe,
			describe: () => ({
				...attempt(durationMs),
				response: undefined,
				transportFailure: { errorName: errorName(error), errorCode: errorCode(error) ?? errorCode(member(error, "cause")) },
				classification: "transport-failed",
			}),
		});
		throw error;
	});
	const durationMs = input.now().getTime() - startedAt;
	return {
		response,
		settle: ({ classification, bodyReads }) =>
			record({
				observe,
				describe: () => ({
					...attempt(durationMs),
					response: responseEvidence({ response, expectedOrigin: target.expectedOrigin, bodyReads }),
					transportFailure: undefined,
					classification,
				}),
			}),
	};
}
