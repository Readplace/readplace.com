type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export function urlFromInput(input: FetchInput): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

export function toPlainHeaders(headers: NonNullable<FetchInit>["headers"]): Record<string, string> | undefined {
	if (!headers) return undefined;
	const out: Record<string, string> = {};
	new Headers(headers).forEach((value, key) => {
		out[key] = value;
	});
	return out;
}
