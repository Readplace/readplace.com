export const READER_IMAGE_SIZE_ATTRIBUTE = "data-reader-image-size";

export type ReaderImageSize = { width: number; height: number; sourceSize?: string };

const STORED_SIZE = /^([1-9]\d{0,4})x([1-9]\d{0,4})(?: (100vw|[1-9]\d{0,4}px|min\(100vw,[1-9]\d{0,4}px\)))?$/;

const BOX_STYLE =
	/^--reader-image-width:(?:[1-9]\d{0,4}px|100vw|min\(100vw,[1-9]\d{0,4}px\));--reader-image-ratio:[1-9]\d{0,4} \/ [1-9]\d{0,4}$/;

export function formatReaderImageSize(size: ReaderImageSize): string | undefined {
	const formatted = `${size.width}x${size.height}${size.sourceSize === undefined ? "" : ` ${size.sourceSize}`}`;
	return STORED_SIZE.test(formatted) ? formatted : undefined;
}

export function readerImageBox(stored: string | undefined): { attribute: string; style: string } | undefined {
	const match = STORED_SIZE.exec(stored ?? "");
	if (!match) return undefined;
	const [attribute, width, height, sourceSize = `${width}px`] = match;
	return {
		attribute,
		style: `--reader-image-width:${sourceSize};--reader-image-ratio:${width} / ${height}`,
	};
}

export function isReaderImageBoxStyle(style: string | null): boolean {
	return BOX_STYLE.test(style ?? "");
}
