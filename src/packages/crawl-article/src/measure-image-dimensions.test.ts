import { deflateSync } from "node:zlib";
import { measureImageDimensions } from "./measure-image-dimensions";

function pngChunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}

function png(image: { width: number; height: number; chunks?: Buffer[]; end?: boolean }): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(image.width, 0);
	ihdr.writeUInt32BE(image.height, 4);
	ihdr.writeUInt8(8, 8);
	ihdr.writeUInt8(0, 9);
	const scanlines = Buffer.alloc((image.width + 1) * image.height);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		...(image.chunks ?? []),
		pngChunk("IDAT", deflateSync(scanlines)),
		...(image.end === false ? [] : [pngChunk("IEND", Buffer.alloc(0))]),
	]);
}

function pngDensity(pixelsPerMetre: number): Buffer {
	const phys = Buffer.alloc(9);
	phys.writeUInt32BE(pixelsPerMetre, 0);
	phys.writeUInt32BE(pixelsPerMetre, 4);
	phys.writeUInt8(1, 8);
	return pngChunk("pHYs", phys);
}

function exifOrientation(orientation: number): Buffer {
	const tiff = Buffer.alloc(26);
	tiff.write("MM", 0, "ascii");
	tiff.writeUInt16BE(42, 2);
	tiff.writeUInt32BE(8, 4);
	tiff.writeUInt16BE(1, 8);
	tiff.writeUInt16BE(274, 10);
	tiff.writeUInt16BE(3, 12);
	tiff.writeUInt32BE(1, 14);
	tiff.writeUInt16BE(orientation, 18);
	return tiff;
}

function gifFrame(frame: { left: number; top: number; width: number; height: number }): Buffer {
	const descriptor = Buffer.alloc(10);
	descriptor.writeUInt8(0x2c, 0);
	descriptor.writeUInt16LE(frame.left, 1);
	descriptor.writeUInt16LE(frame.top, 3);
	descriptor.writeUInt16LE(frame.width, 5);
	descriptor.writeUInt16LE(frame.height, 7);
	return Buffer.concat([descriptor, Buffer.from([0x02, 0x01, 0x00, 0x00])]);
}

const GIF_LOOPING = Buffer.concat([
	Buffer.from([0x21, 0xff, 0x0b]),
	Buffer.from("NETSCAPE2.0", "ascii"),
	Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
]);

const GIF_FRAME_DELAY = Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00]);

function gif(image: {
	width: number;
	height: number;
	globalColours?: boolean;
	blocks?: Buffer[];
}): Buffer {
	const screen = Buffer.alloc(7);
	screen.writeUInt16LE(image.width, 0);
	screen.writeUInt16LE(image.height, 2);
	screen.writeUInt8(image.globalColours ? 0x80 : 0, 4);
	const colours = image.globalColours ? [Buffer.alloc(6)] : [];
	const blocks = image.blocks ?? [gifFrame({ left: 0, top: 0, width: image.width, height: image.height })];
	return Buffer.concat([Buffer.from("GIF89a", "ascii"), screen, ...colours, ...blocks, Buffer.from([0x3b])]);
}

function jpegSegment(marker: number, payload: Buffer): Buffer {
	const header = Buffer.alloc(4);
	header.writeUInt16BE(marker, 0);
	header.writeUInt16BE(payload.length + 2, 2);
	return Buffer.concat([header, payload]);
}

const JPEG_START_OF_SCAN = jpegSegment(0xffda, Buffer.alloc(0));

const JPEG_JFIF = jpegSegment(0xffe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]));

function jpeg(image: { width: number; height: number; before?: Buffer[]; after?: Buffer[] }): Buffer {
	const frame = Buffer.alloc(15);
	frame.writeUInt8(8, 0);
	frame.writeUInt16BE(image.height, 1);
	frame.writeUInt16BE(image.width, 3);
	return Buffer.concat([
		Buffer.from([0xff, 0xd8]),
		...(image.before ?? [JPEG_JFIF]),
		jpegSegment(0xffc0, frame),
		...(image.after ?? [JPEG_START_OF_SCAN]),
		Buffer.from([0xff, 0xd9]),
	]);
}

function jpegExif(orientation: number): Buffer {
	return jpegSegment(0xffe1, Buffer.concat([Buffer.from("Exif\0\0", "ascii"), exifOrientation(orientation)]));
}

function ico(images: { width: number; height: number }[]): Buffer {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	const entries = images.map((image) => {
		const entry = Buffer.alloc(16);
		entry.writeUInt8(image.width, 0);
		entry.writeUInt8(image.height, 1);
		return entry;
	});
	return Buffer.concat([header, ...entries]);
}

function svg(attributes: string): Buffer {
	return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}></svg>`, "utf8");
}

function riffChunk(fourcc: string, data: Buffer): Buffer {
	const header = Buffer.alloc(8);
	header.write(fourcc, 0, "ascii");
	header.writeUInt32LE(data.length, 4);
	return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
}

function webp(image: { width: number; height: number; chunks?: Buffer[] }): Buffer {
	const canvas = Buffer.alloc(10);
	canvas.writeUIntLE(image.width - 1, 4, 3);
	canvas.writeUIntLE(image.height - 1, 7, 3);
	const chunks = Buffer.concat([riffChunk("VP8X", canvas), ...(image.chunks ?? [])]);
	const header = Buffer.alloc(12);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(chunks.length + 4, 4);
	header.write("WEBP", 8, "ascii");
	return Buffer.concat([header, chunks]);
}

function bmp(size: { width: number; height: number }): Buffer {
	const header = Buffer.alloc(54);
	header.write("BM", 0, "ascii");
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(size.width, 18);
	header.writeInt32LE(size.height, 22);
	return header;
}

function isoBox(type: string, payload: Buffer): Buffer {
	const size = Buffer.alloc(4);
	size.writeUInt32BE(payload.length + 8);
	return Buffer.concat([size, Buffer.from(type, "ascii"), payload]);
}

function avif(size: { width: number; height: number }): Buffer {
	const ispe = Buffer.alloc(12);
	ispe.writeUInt32BE(size.width, 4);
	ispe.writeUInt32BE(size.height, 8);
	return Buffer.concat([
		isoBox("ftyp", Buffer.from("avif\0\0\0\0avif", "ascii")),
		isoBox("meta", Buffer.concat([Buffer.alloc(4), isoBox("iprp", isoBox("ipco", isoBox("ispe", ispe)))])),
	]);
}

describe("measureImageDimensions", () => {
	describe("a PNG", () => {
		it("reads its IHDR size", () => {
			expect(measureImageDimensions(png({ width: 3, height: 2 }))).toEqual({ width: 3, height: 2 });
		});

		it("reads its IHDR size when a pHYs chunk declares a density, which browsers ignore", () => {
			expect(measureImageDimensions(png({ width: 800, height: 600, chunks: [pngDensity(5669)] }))).toEqual({
				width: 800,
				height: 600,
			});
		});

		it("returns undefined when an eXIf chunk can change the size a browser renders", () => {
			expect(
				measureImageDimensions(png({ width: 80, height: 60, chunks: [pngChunk("eXIf", exifOrientation(6))] })),
			).toBeUndefined();
		});

		it("returns undefined when its chunks end before IEND", () => {
			expect(measureImageDimensions(png({ width: 3, height: 2, end: false }))).toBeUndefined();
		});
	});

	describe("a JPEG", () => {
		it("reads its frame size", () => {
			expect(measureImageDimensions(jpeg({ width: 1456, height: 1005 }))).toEqual({ width: 1456, height: 1005 });
		});

		it("reads its frame size when an APP1 segment holds XMP rather than EXIF", () => {
			const xmp = jpegSegment(0xffe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x/>", "ascii"));

			expect(measureImageDimensions(jpeg({ width: 1456, height: 1005, before: [xmp] }))).toEqual({
				width: 1456,
				height: 1005,
			});
		});

		it.each([1, 6])("returns undefined when it carries EXIF, here orientation %i", (orientation) => {
			expect(
				measureImageDimensions(jpeg({ width: 1456, height: 1005, before: [jpegExif(orientation)] })),
			).toBeUndefined();
		});

		it("returns undefined when its segments end before the start of scan", () => {
			expect(measureImageDimensions(jpeg({ width: 1456, height: 1005, after: [] }))).toBeUndefined();
		});

		it("returns undefined when a byte that is not a marker follows a segment", () => {
			expect(
				measureImageDimensions(jpeg({ width: 1456, height: 1005, after: [Buffer.from([0, 0, 0, 0]), JPEG_START_OF_SCAN] })),
			).toBeUndefined();
		});
	});

	describe("a GIF", () => {
		it("reads its logical screen size", () => {
			expect(measureImageDimensions(gif({ width: 300, height: 200 }))).toEqual({ width: 300, height: 200 });
		});

		it("reads its logical screen size past a global colour table", () => {
			expect(measureImageDimensions(gif({ width: 300, height: 200, globalColours: true }))).toEqual({
				width: 300,
				height: 200,
			});
		});

		it("reads an animated GIF's logical screen size when its first frame fits inside it", () => {
			const frame = gifFrame({ left: 10, top: 5, width: 290, height: 195 });

			expect(
				measureImageDimensions(
					gif({ width: 300, height: 200, blocks: [GIF_LOOPING, GIF_FRAME_DELAY, frame, GIF_FRAME_DELAY, frame] }),
				),
			).toEqual({ width: 300, height: 200 });
		});

		it.each([
			["wider", { left: 0, top: 0, width: 40, height: 15 }],
			["taller", { left: 0, top: 0, width: 20, height: 30 }],
			["offset past the right edge", { left: 1, top: 0, width: 20, height: 15 }],
			["offset past the bottom edge", { left: 0, top: 1, width: 20, height: 15 }],
		])("returns undefined when its first frame is %s than its logical screen", (_case, frame) => {
			expect(measureImageDimensions(gif({ width: 20, height: 15, blocks: [gifFrame(frame)] }))).toBeUndefined();
		});

		it("returns undefined when it holds no frame", () => {
			expect(measureImageDimensions(gif({ width: 20, height: 15, blocks: [] }))).toBeUndefined();
		});

		it("returns undefined when an extension block runs past the end of the file", () => {
			expect(
				measureImageDimensions(gif({ width: 20, height: 15, blocks: [Buffer.from([0x21, 0xff, 0x0b, 0x4e])] })),
			).toBeUndefined();
		});
	});

	describe("a WebP", () => {
		it("reads its canvas size", () => {
			expect(measureImageDimensions(webp({ width: 1456, height: 1005 }))).toEqual({ width: 1456, height: 1005 });
		});

		it("reads its canvas size past chunks of odd length", () => {
			expect(
				measureImageDimensions(webp({ width: 1456, height: 1005, chunks: [riffChunk("XMP ", Buffer.alloc(3))] })),
			).toEqual({ width: 1456, height: 1005 });
		});

		it("returns undefined when an EXIF chunk can change the size a browser renders", () => {
			expect(
				measureImageDimensions(webp({ width: 80, height: 60, chunks: [riffChunk("EXIF", exifOrientation(6))] })),
			).toBeUndefined();
		});
	});

	it("returns undefined for an icon, which holds several sizes", () => {
		expect(
			measureImageDimensions(
				ico([
					{ width: 32, height: 32 },
					{ width: 16, height: 16 },
				]),
			),
		).toBeUndefined();
	});

	it("returns undefined for an SVG, which has no single natural size", () => {
		expect(measureImageDimensions(svg('width="640" height="480"'))).toBeUndefined();
	});

	it("returns undefined for an AVIF, whose rotation is not read", () => {
		expect(measureImageDimensions(avif({ width: 640, height: 480 }))).toBeUndefined();
	});

	it("returns undefined for a BMP", () => {
		expect(measureImageDimensions(bmp({ width: 640, height: 480 }))).toBeUndefined();
	});

	it("returns undefined when a side is above 99999 pixels", () => {
		expect(measureImageDimensions(png({ width: 100000, height: 1 }))).toBeUndefined();
		expect(measureImageDimensions(png({ width: 1, height: 100000 }))).toBeUndefined();
	});

	it("returns undefined when a side is zero", () => {
		expect(measureImageDimensions(png({ width: 0, height: 2 }))).toBeUndefined();
	});

	it("returns undefined for bytes that are not an image", () => {
		expect(measureImageDimensions(Buffer.from("not an image at all", "utf8"))).toBeUndefined();
	});

	it("returns undefined for an empty body", () => {
		expect(measureImageDimensions(Buffer.alloc(0))).toBeUndefined();
	});
});
