/* c8 ignore start -- thin mupdf-wasm boundary wrapper, exercised in production at Lambda cold start and in CI via the PDF health canary (scripts/health-sources.ts → arXiv Transformer paper). The dynamic `import()` resolves to mupdf's ESM build at runtime; Jest's CJS transformer cannot load that, so all tests stub PdfRasterizer at the OCR consumer (see ocr-pdf.test.ts). */
import { cachedImport } from "./cached-import";
import type { PdfDocument, PdfPage, PdfRasterizer } from "./pdf-extract.types";

/**
 * mupdf v1.x is ESM-only AND has a top-level `await` to instantiate its
 * WASM module. esbuild cannot bundle a top-level-await module into a CJS
 * output, and TypeScript's CJS transpiler rewrites `await import("mupdf")`
 * into `require("mupdf")` — which Node 22's require(esm) refuses for the
 * same top-level-await reason (ERR_REQUIRE_ASYNC_MODULE).
 *
 * The workaround is to hide the dynamic import from both TS and esbuild
 * by constructing it via `new Function`. At runtime this is a real
 * `import()` against the ESM specifier, which Node loads correctly from
 * the Lambda zip's `node_modules/mupdf/` (shipped via HutchLambda's
 * `external` option). The cached promise ensures the WASM module loads
 * once per Lambda container.
 *
 * Render scale 2 yields ~150 DPI on a 72-DPI source PDF, which gives the
 * DeepInfra vision model enough resolution to read small caption text
 * reliably while keeping per-page PNGs around 300–500 KB.
 */
const DEFAULT_RENDER_SCALE = 2;

type MupdfModule = typeof import("mupdf");

const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;

const loadMupdfModule = cachedImport<MupdfModule>(async () => {
	const t0 = Date.now();
	console.info("[init-mupdf] loading mupdf wasm");
	const mod = await dynamicImport("mupdf");
	console.info(`[init-mupdf] loaded mupdf wasm dt=${Date.now() - t0}ms`);
	return mod as MupdfModule;
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
