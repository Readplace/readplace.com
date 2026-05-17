import { cachedImport } from "./cached-import";
import { initPdfExtract } from "./pdf-extract";
import type { ExtractPdf, PdfjsLib, PdfjsLibBase } from "./pdf-extract.types";

/**
 * pdfjs-dist v4 is ESM-only; this package and every callsite (Lambda runtime
 * entry points, hutch SSR) compile to CommonJS. The only way to consume the
 * legacy build is a dynamic `import()`, which TypeScript leaves intact across
 * the commonjs target.
 *
 * `loadPdfjsLib` returns the text-extraction shape because that's the only
 * surface this package itself uses. Consumers that need additional surfaces
 * (e.g. OCR rendering in save-link) use `loadPdfjsLibAs<TPage>` to specialize
 * the page type while sharing the same cached promise — the real pdfjs
 * `PDFPageProxy` satisfies any page interface the caller cares to declare.
 *
 * The unknown-cast is bounded to this single boundary: pdfjs's published
 * types reference DOM globals (HTMLCanvasElement) that our commonjs tsconfigs
 * don't include. The runtime surface each consumer actually uses is fully
 * described by the duck-typed `PdfjsLibBase` interface family.
 */
/**
 * pdfjs's PDFWorker checks `globalThis.pdfjsWorker?.WorkerMessageHandler`
 * before falling back to `await import("./pdf.worker.mjs")` for its
 * fake-worker setup. In a bundled Lambda the relative dynamic import
 * resolves against /var/task/index.js (no sidecar there) and the parse
 * fails. Pre-loading pdf.worker.mjs and assigning it to globalThis makes
 * pdfjs hit the in-memory path and skip the sidecar lookup entirely.
 */
const loadCached = cachedImport(async () => {
	const [pdfjsLib, pdfjsWorker] = await Promise.all([
		import("pdfjs-dist/legacy/build/pdf.mjs"),
		// pdfjs-dist doesn't ship types for the worker entry; the module value
		// is opaque — we only assign it to globalThis for pdfjs to read.
		// @ts-expect-error: no declaration file for pdf.worker.mjs
		import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
	]);
	(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;
	return pdfjsLib;
});

export function loadPdfjsLib(): Promise<PdfjsLib> {
	return loadCached().then((mod) => mod as unknown as PdfjsLib);
}

export function loadPdfjsLibAs<TPage>(): Promise<PdfjsLibBase<TPage>> {
	return loadCached().then((mod) => mod as unknown as PdfjsLibBase<TPage>);
}

/**
 * Lazily-loaded text-layer extractor: callers that don't need OCR can wire
 * this directly into `initCrawlArticle`. The pdfjs module loads on first use
 * (cached after that) so consumers don't pay the ESM-import cost at module
 * load time.
 */
export function initLazyPdfExtractTextOnly(): ExtractPdf {
	let cached: ExtractPdf | undefined;
	return async (params) => {
		if (!cached) {
			const pdfjsLib = await loadPdfjsLib();
			cached = initPdfExtract({ pdfjsLib });
		}
		return cached(params);
	};
}
