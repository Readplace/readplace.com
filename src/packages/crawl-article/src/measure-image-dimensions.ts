import { imageSize } from "image-size";

export type ImageDimensions = { width: number; height: number };

const MAX_LAYOUT_LENGTH = 99999;

const JPEG_START_OF_SCAN = 0xffda;

const JPEG_APP1 = 0xffe1;

const JPEG_FIRST_MARKER = 0xff00;

function isLayoutLength(value: number): boolean {
	return value > 0 && value <= MAX_LAYOUT_LENGTH;
}

function orUndefined<T>(read: () => T): T | undefined {
	try {
		return read();
	} catch {
		return undefined;
	}
}

function pngHasNoExif(body: Buffer): boolean {
	let offset = 8;
	let type = body.toString("latin1", offset + 4, offset + 8);
	while (type !== "IEND") {
		if (type === "eXIf") return false;
		offset += 12 + body.readUInt32BE(offset);
		type = body.toString("latin1", offset + 4, offset + 8);
	}
	return true;
}

function jpegHasNoExif(body: Buffer): boolean {
	let offset = 2;
	let marker = body.readUInt16BE(offset);
	while (marker !== JPEG_START_OF_SCAN) {
		const isExif = marker === JPEG_APP1 && body.toString("latin1", offset + 4, offset + 10) === "Exif\0\0";
		if (marker < JPEG_FIRST_MARKER || isExif) return false;
		offset += 2 + body.readUInt16BE(offset + 2);
		marker = body.readUInt16BE(offset);
	}
	return true;
}

function webpHasNoExif(body: Buffer): boolean {
	let offset = 12;
	while (offset + 8 <= body.length) {
		if (body.toString("latin1", offset, offset + 4) === "EXIF") return false;
		const size = body.readUInt32LE(offset + 4);
		offset += 8 + size + (size % 2);
	}
	return true;
}

function gifFirstFrameFitsScreen(body: Buffer): boolean {
	const packed = body.readUInt8(10);
	let offset = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
	while (body.readUInt8(offset) === 0x21) {
		offset += 2;
		for (let blockSize = body.readUInt8(offset); blockSize !== 0; blockSize = body.readUInt8(offset)) {
			offset += blockSize + 1;
		}
		offset += 1;
	}
	return (
		body.readUInt8(offset) === 0x2c &&
		body.readUInt16LE(offset + 1) + body.readUInt16LE(offset + 5) <= body.readUInt16LE(6) &&
		body.readUInt16LE(offset + 3) + body.readUInt16LE(offset + 7) <= body.readUInt16LE(8)
	);
}

const RENDERS_AT_STORED_SIZE = new Map<string | undefined, (body: Buffer) => boolean>([
	["png", pngHasNoExif],
	["jpg", jpegHasNoExif],
	["gif", gifFirstFrameFitsScreen],
	["webp", webpHasNoExif],
]);

export function measureImageDimensions(body: Buffer): ImageDimensions | undefined {
	const size = orUndefined(() => imageSize(body));
	const rendersAtStoredSize = RENDERS_AT_STORED_SIZE.get(size?.type);
	if (!size || !rendersAtStoredSize || !orUndefined(() => rendersAtStoredSize(body))) return undefined;
	const { width, height } = size;
	if (!isLayoutLength(width) || !isLayoutLength(height)) return undefined;
	return { width, height };
}
