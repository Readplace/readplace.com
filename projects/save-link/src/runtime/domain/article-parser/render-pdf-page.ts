/**
 * pdfjs-dist renders pages into a CanvasRenderingContext2D. In Node we don't
 * have a DOM, so we supply `@napi-rs/canvas` — a pure native binding (~5 MB
 * prebuilt Linux x64) that implements the same interface. The shape pdfjs
 * needs at runtime is small (just `getContext("2d")` and `toBuffer("image/png")`),
 * so we describe it via a minimal duck-typed interface instead of pulling in
 * the DOM lib for typing.
 */

/** Subset of the napi-rs/canvas factory that pdfjs's `NodeCanvasFactory` uses. */
export interface CanvasLike {
	width: number;
	height: number;
	getContext(contextId: "2d"): unknown;
	toBuffer(format: "image/png"): Buffer;
}

export type CreateCanvas = (width: number, height: number) => CanvasLike;

/** Page object subset we depend on from pdfjs. */
export interface RenderablePdfPage {
	getViewport(params: { scale: number }): { width: number; height: number };
	render(params: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
}

export type RenderPdfPage = (params: { page: RenderablePdfPage; scale: number }) => Promise<Buffer>;

export function initRenderPdfPage(deps: { createCanvas: CreateCanvas }): RenderPdfPage {
	return async ({ page, scale }) => {
		const viewport = page.getViewport({ scale });
		const canvas = deps.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
		const context = canvas.getContext("2d");
		await page.render({ canvasContext: context, viewport }).promise;
		return canvas.toBuffer("image/png");
	};
}
