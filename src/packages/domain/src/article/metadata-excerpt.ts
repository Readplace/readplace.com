export const METADATA_EXCERPT_MAX_LENGTH = 240;

export function clipMetadataExcerpt(text: string): string {
	if (text.length <= METADATA_EXCERPT_MAX_LENGTH) return text;
	const head = text.slice(0, METADATA_EXCERPT_MAX_LENGTH + 1);
	const lastSpace = head.lastIndexOf(" ");
	return `${head.slice(0, lastSpace > 0 ? lastSpace : METADATA_EXCERPT_MAX_LENGTH)}…`;
}
