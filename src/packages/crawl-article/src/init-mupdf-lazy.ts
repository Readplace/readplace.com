/* c8 ignore start -- thin mupdf-wasm boundary wrapper, exercised in production at Lambda cold start and in CI via the PDF health canary (scripts/health-sources.ts → arXiv Transformer paper). The dynamic `import()` resolves to mupdf's ESM build at runtime; Jest's CJS transformer cannot load that, so all tests stub PdfRasterizer at the OCR consumer (see ocr-pdf.test.ts). */
import { cachedImport } from "./cached-import";
import type { PdfDocument, PdfPage, PdfRasterizer } from "./pdf-extract.types";

/**
 * mupdf v1.x is ESM-only; this package and every callsite (Lambda runtime
 * entry points, hutch SSR) compile to CommonJS. The only way to consume it
 * is a dynamic `import()`, which esbuild bundles inline alongside the rest
 * of the handler at build time.
 *
 * mupdf ships a sidecar `mupdf-wasm.wasm` that its loader locates via
 * `new URL("mupdf-wasm.wasm", import.meta.url)`. esbuild rewrites
 * `import.meta.url` to the bundle's file URL when emitting CJS for Node, so
 * the sidecar must be copied next to the handler's `index.js` at deploy time
 * — see HutchLambda's `wasmFiles` option in
 * `src/packages/hutch-infra-components/src/infra/hutch-lambda.ts`.
 *
 * Render scale 2 yields ~150 DPI on a 72-DPI source PDF, which gives the
 * DeepInfra vision model enough resolution to read small caption text
 * reliably while keeping per-page PNGs around 300–500 KB.
 */
const DEFAULT_RENDER_SCALE = 2;

type MupdfModule = typeof import("mupdf");

const loadMupdfModule = cachedImport<MupdfModule>(async () => {
	const mod = await import("mupdf");
	return mod;
});

export function initMupdfRasterizer(opts?: { scale?: number }): PdfRasterizer {
	const scale = opts?.scale ?? DEFAULT_RENDER_SCALE;
	return {
		async open(buffer: Buffer): Promise<PdfDocument> {
			const mupdf = await loadMupdfModule();
			const doc = mupdf.PDFDocument.openDocument(buffer, "application/pdf");
			const matrix = mupdf.Matrix.scale(scale, scale);
			return {
				get numPages() {
					return doc.countPages();
				},
				loadPage(index: number): PdfPage {
					const page = doc.loadPage(index);
					return {
						renderToPng(): Buffer {
							const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
							const png = Buffer.from(pixmap.asPNG());
							pixmap.destroy();
							return png;
						},
						destroy(): void {
							page.destroy();
						},
					};
				},
				getTitle(): string | undefined {
					const raw = doc.getMetaData("info:Title");
					if (typeof raw !== "string") return undefined;
					const trimmed = raw.trim();
					return trimmed.length > 0 ? trimmed : undefined;
				},
				destroy(): void {
					doc.destroy();
				},
			};
		},
	};
}
/* c8 ignore stop */
