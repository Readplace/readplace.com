import { isIP, isIPv6 } from "node:net";
import { z } from "zod";
import { isPrivateIPv4, isPrivateIPv6, unwrapIpv6 } from "./blocked-address";

export const SaveableUrlErrorCodeSchema = z.enum([
	"unsupported_scheme",
	"private_network", /* c8 ignore next -- V8 block coverage phantom: zero-count sub-range at bytecode boundary (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
	"malformed_url",
]);
export type SaveableUrlErrorCode = z.infer<typeof SaveableUrlErrorCodeSchema>;

export interface SaveableUrlError {
	readonly code: SaveableUrlErrorCode;
	readonly message: string;
}

export type SaveableUrlResult =
	| { readonly status: "SUCCESS"; readonly url: SaveableUrl }
	| { readonly status: "ERROR"; readonly error: SaveableUrlError };

export type ValidateSaveableUrl = (value: unknown) => SaveableUrlResult;

const SaveableUrlBrand = z.string().brand<"SaveableUrl">();
export type SaveableUrl = z.infer<typeof SaveableUrlBrand>;

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/** Above any legitimate article URL and the ~2k-8k ceilings browsers, proxies,
 * and CDNs enforce. Every save path funnels through this validator, so this one
 * rule bounds stored URLs, dedup keys, and crawler fetches — and any
 * URL-rewriting decorator composed in front must gate on it BEFORE rewriting,
 * because decorators run before this check. */
export const MAX_SAVEABLE_URL_LENGTH = 8192;

const LOCAL_HOSTNAME_SUFFIXES: readonly string[] = [
	".local",
	".home.arpa",
	".lan",
	".internal",
];

const SINGLETON_LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
	"localhost",
	"ip6-localhost",
	"ip6-loopback",
]);

function stripTrailingDot(host: string): string {
	return host.endsWith(".") ? host.slice(0, -1) : host;
}

function isPrivateHostname(host: string): boolean {
	const lower = stripTrailingDot(host).toLowerCase();
	if (SINGLETON_LOCAL_HOSTNAMES.has(lower)) return true;
	if (LOCAL_HOSTNAME_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
	if (isPrivateIPv4(lower)) return true;
	if (isPrivateIPv6(lower)) return true;
	return false;
}

/** Hostname is an RFC-1123 FQDN with at least one dot separating the host
 * from the TLD. Letters, digits, and hyphens only; bare hostnames without a
 * dot are rejected to catch typos of local-network suffixes (`somethinglan`)
 * and bare intranet hosts (`server`). IP literals are detected separately. */
const HOSTNAME_SHAPE = /^[a-z0-9][a-z0-9.-]*\.[a-z0-9-]*[a-z0-9]$/i; /* c8 ignore next -- V8 block coverage phantom: regex quantifier compile branch (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */

function isWellFormedHostname(host: string): boolean {
	const stripped = stripTrailingDot(host);
	if (stripped.includes("..")) return false;
	if (stripped.startsWith("[") && stripped.endsWith("]")) {
		return isIPv6(unwrapIpv6(stripped));
	}
	if (isIP(stripped) !== 0) return true;
	return HOSTNAME_SHAPE.test(stripped);
}

const SAVEABLE_URL_ERROR_MESSAGES: Record<SaveableUrlErrorCode, string> = {
	malformed_url: "Please enter a valid URL",
	unsupported_scheme: "Only http and https URLs can be saved",
	private_network: "Private-network and loopback addresses can't be saved",
};

export function saveableUrlErrorMessage(code: SaveableUrlErrorCode): string {
	return SAVEABLE_URL_ERROR_MESSAGES[code];
}

function tryParseUrl(value: string): URL | null {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

export function validateSaveableUrl(value: unknown): SaveableUrlResult {
	if (typeof value !== "string") return errorResult("malformed_url");
	const trimmed = value.trim();
	if (trimmed.length === 0) return errorResult("malformed_url"); /* c8 ignore next -- V8 block coverage phantom: zero-count sub-range at bytecode boundary (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
	if (trimmed.length > MAX_SAVEABLE_URL_LENGTH) return errorResult("malformed_url");
	const parsed = tryParseUrl(trimmed);
	if (!parsed) return errorResult("malformed_url");
	if (!ALLOWED_SCHEMES.has(parsed.protocol)) return errorResult("unsupported_scheme"); /* c8 ignore next -- V8 block coverage phantom: zero-count sub-range at bytecode boundary (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
	const hostname = parsed.hostname;
	if (hostname.length === 0) return errorResult("malformed_url");
	/** Check private-network BEFORE well-formedness so bare local names like
	 * `localhost` produce a private_network error (which is what they mean)
	 * rather than malformed_url (which they technically also are). */
	if (isPrivateHostname(hostname)) return errorResult("private_network");
	if (!isWellFormedHostname(hostname)) return errorResult("malformed_url");
	return { status: "SUCCESS", url: SaveableUrlBrand.parse(parsed.toString()) };
}

function errorResult(code: SaveableUrlErrorCode): SaveableUrlResult {
	return { status: "ERROR", error: { code, message: SAVEABLE_URL_ERROR_MESSAGES[code] } };
}

/** Zod schema wrapper around the validator so HTTP boundaries can keep
 * using `safeParse()` for form-field validation. The custom issue carries the
 * error code via its params so callers that need to branch on the failure
 * kind can do so without re-running the validator. */
export const SaveableUrlSchema = z.string().transform((value, ctx) => {
	const result = validateSaveableUrl(value);
	if (result.status === "SUCCESS") return result.url;
	ctx.addIssue({
		code: "custom",
		message: result.error.message,
		params: { saveableUrlCode: result.error.code },
	}); /* c8 ignore next -- V8 block coverage phantom: zero-count sub-range at bytecode boundary (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
	return z.NEVER;
});

const SaveableUrlIssueParamsSchema = z.object({
	saveableUrlCode: SaveableUrlErrorCodeSchema,
});

export function saveableUrlCodeFromIssues(
	issues: readonly z.core.$ZodIssue[],
): SaveableUrlErrorCode | undefined {
	for (const issue of issues) {
		if (issue.code !== "custom") continue;
		const parsed = SaveableUrlIssueParamsSchema.safeParse(issue.params);
		if (parsed.success) return parsed.data.saveableUrlCode;
	}
	return undefined;
}
