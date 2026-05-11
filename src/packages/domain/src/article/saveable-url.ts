import assert from "node:assert";
import { isIP, isIPv4, isIPv6 } from "node:net";
import { z } from "zod";

export type SaveableUrlErrorCode =
	| "unsupported_scheme"
	| "private_network"
	| "malformed_url";

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

const SINGLETON_LOCAL_IPV6: ReadonlySet<string> = new Set([
	"::1",
	"::",
]);

function stripTrailingDot(host: string): string {
	return host.endsWith(".") ? host.slice(0, -1) : host;
}

function isPrivateIPv4(host: string): boolean {
	if (!isIPv4(host)) return false;
	const parts = host.split(".").map((p) => Number.parseInt(p, 10));
	const [a, b] = parts;
	if (a === 127) return true; /* 127.0.0.0/8 loopback */
	if (a === 10) return true; /* 10.0.0.0/8 RFC 1918 */
	if (a === 192 && b === 168) return true; /* 192.168.0.0/16 RFC 1918 */
	if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true; /* 172.16.0.0/12 RFC 1918 */
	if (a === 169 && b === 254) return true; /* 169.254.0.0/16 link-local */
	if (a === 0) return true; /* 0.0.0.0/8 "this network" */
	return false;
}

function unwrapIpv6(host: string): string {
	const bracketStripped = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	return bracketStripped.split("%")[0];
}

function isPrivateIPv6(host: string): boolean {
	const inner = unwrapIpv6(host);
	if (!isIPv6(inner)) return false;
	if (SINGLETON_LOCAL_IPV6.has(inner)) return true;
	/** Addresses written with leading `::` have 16+ zero high bits, which
	 * places them outside fc00::/7 (high bit must be 1) and fe80::/10. */
	if (inner.startsWith("::")) return false;
	const firstGroup = inner.split(":")[0];
	assert(firstGroup, "non-:: IPv6 must have a non-empty first hextet");
	const first = Number.parseInt(firstGroup, 16);
	if ((first & 0xfe00) === 0xfc00) return true; /* fc00::/7 unique-local */
	if ((first & 0xffc0) === 0xfe80) return true; /* fe80::/10 link-local */
	return false;
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
	if (stripped.length === 0) return false;
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
	const parsed = tryParseUrl(trimmed);
	if (!parsed) return errorResult("malformed_url");
	if (!ALLOWED_SCHEMES.has(parsed.protocol)) return errorResult("unsupported_scheme");
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

/** Zod schema wrapper around validateSaveableUrl so HTTP boundaries can keep
 * using `safeParse()` for form-field validation. The custom issue carries the
 * SaveableUrlErrorCode via `params.saveableUrlCode` so callers that need to
 * branch on the failure kind (e.g., the extension hypermedia path) can do so
 * without re-running the validator. */
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
	saveableUrlCode: z.enum([
		"unsupported_scheme",
		"private_network",
		"malformed_url",
	]),
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
