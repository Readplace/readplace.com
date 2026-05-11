import { initPdfExtract } from "./pdf-extract";
import type { ExtractPdf, PdfjsLib, PdfjsLibBase } from "./pdf-extract.types";

/**
 * pdfjs-dist v4 is ESM-only; this package and every callsite (Lambda runtime
 * entry points, hutch SSR) compile to CommonJS. The only way to consume the
 * legacy build is a dynamic `import()`, which TypeScript leaves intact across
 * the commonjs target. Cache the resolved module so each Lambda container
 * pays the load cost once and warm invocations skip it.
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
let cachedImport: Promise<unknown> | undefined;

function loadCached(): Promise<unknown> {
	if (!cachedImport) {
		cachedImport = import("pdfjs-dist/legacy/build/pdf.mjs");
	}
	return cachedImport;
}

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
