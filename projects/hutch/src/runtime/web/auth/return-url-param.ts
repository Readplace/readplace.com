const RELATIVE_URL_BASE = "http://relative";

export function returnUrlQueryParam(input: {
	returnUrl: string | undefined;
	path: string;
	param: string;
}): string | null | undefined {
	const { returnUrl, path, param } = input;
	if (!returnUrl || !URL.canParse(returnUrl, RELATIVE_URL_BASE)) return undefined;
	const parsed = new URL(returnUrl, RELATIVE_URL_BASE);
	if (parsed.pathname !== path) return undefined;
	return parsed.searchParams.get(param);
}
