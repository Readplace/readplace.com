export function etagMatches(
	ifNoneMatchHeader: string | undefined,
	etag: string,
): boolean {
	if (!ifNoneMatchHeader) return false;
	return ifNoneMatchHeader
		.split(",")
		.map((part) => part.trim())
		.includes(etag);
}
