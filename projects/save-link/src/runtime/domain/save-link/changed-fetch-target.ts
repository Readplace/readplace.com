export function changedFetchTarget(params: { requestedUrl: string; finalUrl: string | undefined }): string | undefined {
	const { requestedUrl, finalUrl } = params;
	if (finalUrl === undefined) return undefined;
	return new URL(finalUrl).href === new URL(requestedUrl).href ? undefined : finalUrl;
}
