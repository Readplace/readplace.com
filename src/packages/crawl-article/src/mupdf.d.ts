/**
 * mupdf v1.x ships typed `.d.ts` declarations only via its `exports` field,
 * which TypeScript only honours under `moduleResolution: "node16"` /
 * `"nodenext"` / `"bundler"`. This monorepo compiles with the legacy
 * `"node"` resolver to keep CJS interop simple, so we declare the subset of
 * the mupdf API the rasterizer wraps explicitly here. The full surface is
 * documented at https://mupdfjs.readthedocs.io.
 */
declare module "mupdf" {
	export class PDFDocument {
		static openDocument(buffer: Uint8Array | Buffer, magic: string): PDFDocument;
		countPages(): number;
		loadPage(index: number): PDFPage;
		getMetaData(key: string): string | undefined;
		destroy(): void;
	}

	export class PDFPage {
		toPixmap(
			ctm: Matrix,
			colorspace: ColorSpace,
			alpha: boolean,
			showExtras: boolean,
		): Pixmap;
		destroy(): void;
	}

	export class Pixmap {
		asPNG(): Uint8Array;
		destroy(): void;
	}

	export type Matrix = [number, number, number, number, number, number];

	export const Matrix: {
		identity: Matrix;
		scale(sx: number, sy: number): Matrix;
	};

	export class ColorSpace {
		static readonly DeviceRGB: ColorSpace;
		static readonly DeviceGray: ColorSpace;
	}
}
