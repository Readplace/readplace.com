import { initRenderPdfPage, type CanvasLike, type RenderablePdfPage } from "./render-pdf-page";

function stubCanvas(): CanvasLike {
	let pngOutput: Buffer | undefined;
	const canvas: CanvasLike = {
		width: 0,
		height: 0,
		getContext: () => ({ stubContext: true }),
		toBuffer: () => {
			pngOutput ??= Buffer.from([0x89, 0x50, 0x4e, 0x47]);
			return pngOutput;
		},
	};
	return canvas;
}

function stubPage(overrides?: Partial<RenderablePdfPage>): {
	page: RenderablePdfPage;
	captured: { renderArgs?: { canvasContext: unknown; viewport: unknown } };
} {
	const captured: { renderArgs?: { canvasContext: unknown; viewport: unknown } } = {};
	const page: RenderablePdfPage = {
		getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }),
		render: (args) => {
			captured.renderArgs = args;
			return { promise: Promise.resolve() };
		},
		...overrides,
	};
	return { page, captured };
}

describe("initRenderPdfPage", () => {
	it("creates a canvas at the viewport size and passes its 2d context to the page render call", async () => {
		const created: Array<{ width: number; height: number }> = [];
		const renderPage = initRenderPdfPage({
			createCanvas: (width, height) => {
				created.push({ width, height });
				return stubCanvas();
			},
		});
		const { page, captured } = stubPage();

		await renderPage({ page, scale: 2 });

		expect(created).toEqual([{ width: 200, height: 400 }]);
		expect(captured.renderArgs?.canvasContext).toEqual({ stubContext: true });
		expect(captured.renderArgs?.viewport).toEqual({ width: 200, height: 400 });
	});

	it("ceils non-integer viewport dimensions so the canvas covers all pixel content", async () => {
		const created: Array<{ width: number; height: number }> = [];
		const renderPage = initRenderPdfPage({
			createCanvas: (width, height) => {
				created.push({ width, height });
				return stubCanvas();
			},
		});
		const { page } = stubPage({ getViewport: () => ({ width: 99.4, height: 200.6 }) });

		await renderPage({ page, scale: 1 });

		expect(created).toEqual([{ width: 100, height: 201 }]);
	});

	it("returns the PNG buffer produced by the canvas", async () => {
		const customCanvas: CanvasLike = {
			...stubCanvas(),
			toBuffer: () => Buffer.from([0xde, 0xad, 0xbe, 0xef]),
		};
		const renderPage = initRenderPdfPage({ createCanvas: () => customCanvas });
		const { page } = stubPage();

		const png = await renderPage({ page, scale: 1 });

		expect(png).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
	});

	it("propagates render errors from the page", async () => {
		const renderPage = initRenderPdfPage({ createCanvas: () => stubCanvas() });
		const { page } = stubPage({
			render: () => ({ promise: Promise.reject(new Error("render boom")) }),
		});

		await expect(renderPage({ page, scale: 1 })).rejects.toThrow("render boom");
	});
});
