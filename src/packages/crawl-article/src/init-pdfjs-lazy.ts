/* c8 ignore start -- thin pdfjs-dist boundary wrapper, tested via integration. The dynamic `import()` resolves to pdfjs-dist's ESM build at runtime, which Jest's CJS transformer cannot load (the dynamic import is rewritten to require() under tsc's CJS output, then fails with ERR_REQUIRE_ESM). Stubbing pdfjs at the OCR consumer (see ocr-pdf.test.ts) is how all other tests cover the surrounding pipeline. Exercised in production at Lambda cold start and in CI via the PDF health canary (scripts/health-sources.ts → arXiv Transformer paper). */
import { cachedImport } from "./cached-import";
import type { PdfjsLibBase } from "./pdf-extract.types";

/**
 * pdfjs-dist v4 is ESM-only; this package and every callsite (Lambda runtime
 * entry points, hutch SSR) compile to CommonJS. The only way to consume the
 * legacy build is a dynamic `import()`, which TypeScript leaves intact across
 * the commonjs target.
 *
 * The OCR pipeline in save-link specializes the page type via
 * `loadPdfjsLibAs<TPage>` so the same cached pdfjs promise serves the page
 * surface each consumer cares about — the real pdfjs `PDFPageProxy` satisfies
 * any page interface declared structurally.
 *
 * The unknown-cast is bounded to this single boundary: pdfjs's published
 * types reference DOM globals (HTMLCanvasElement) that our commonjs tsconfigs
 * don't include. The runtime surface each consumer actually uses is fully
 * described by the duck-typed `PdfjsLibBase` interface family.
 *
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

export async function loadPdfjsLibAs<TPage>(): Promise<PdfjsLibBase<TPage>> {
	const mod = await loadCached();
	return mod as unknown as PdfjsLibBase<TPage>;
}
/* c8 ignore stop */
