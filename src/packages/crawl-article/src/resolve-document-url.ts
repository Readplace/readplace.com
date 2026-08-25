export function resolveDocumentUrl(params: {
	requestedUrl: string;
	finalUrl: string | undefined;
}): string {
	const { requestedUrl, finalUrl } = params;
	return finalUrl ?? requestedUrl;
}
