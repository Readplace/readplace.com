import type { DownloadStagedPdf } from "../../domain/pdf-page-ocr/pdf-page-ocr-handler.types";

/**
 * Wraps a `DownloadStagedPdf` with a single-slot cache keyed by S3 key.
 * Lambda execution environments are reused across invocations, so chunks
 * of the same PDF that land on the same warm container avoid re-issuing
 * a GetObject for the (multi-MB) staged PDF. A new key replaces the
 * cached entry; GC reclaims the previous buffer on assignment. No LRU,
 * no /tmp, no eviction signals — the container itself bounds lifetime.
 */
export function initLastPdfCache(deps: {
	downloadStagedPdf: DownloadStagedPdf;
}): { downloadStagedPdf: DownloadStagedPdf } {
	const { downloadStagedPdf: underlying } = deps;
	let cached: { key: string; buffer: Buffer } | undefined;

	const downloadStagedPdf: DownloadStagedPdf = async ({ key }) => {
		if (cached?.key === key) return cached.buffer;
		const buffer = await underlying({ key });
		cached = { key, buffer };
		return buffer;
	};

	return { downloadStagedPdf };
}
