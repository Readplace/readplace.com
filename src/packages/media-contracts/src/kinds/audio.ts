import { defineMediaKind } from "../media-kind";

const ID3_TAG = Buffer.from("ID3", "ascii");
const FTYP_BOX = Buffer.from("ftyp", "ascii");
const FTYP_OFFSET = 4;
const M4A_BRANDS: readonly string[] = ["M4A ", "M4B ", "mp42", "isom"];

function startsWithId3(bytes: Buffer): boolean {
	return bytes.subarray(0, ID3_TAG.length).equals(ID3_TAG);
}

function startsWithMpegFrameSync(bytes: Buffer): boolean {
	return (
		bytes.length >= 2 &&
		bytes.readUInt8(0) === 0xff &&
		(bytes.readUInt8(1) & 0xe0) === 0xe0
	);
}

function startsWithM4aBox(bytes: Buffer): boolean {
	const brandStart = FTYP_OFFSET + FTYP_BOX.length;
	return (
		bytes.subarray(FTYP_OFFSET, brandStart).equals(FTYP_BOX) &&
		M4A_BRANDS.includes(
			bytes.subarray(brandStart, brandStart + 4).toString("latin1"),
		)
	);
}

export const AUDIO = defineMediaKind({
	name: "audio",
	label: "Audio",
	accepts: { "audio/mpeg": [".mp3"], "audio/mp4": [".m4a"] },
	uploadCeilingBytes: 256 * 1024 * 1024,
	ceilingLabel: "256 MB",
	sniff: (firstBytes) => {
		const bytes = Buffer.from(firstBytes);
		return (
			startsWithId3(bytes) ||
			startsWithMpegFrameSync(bytes) ||
			startsWithM4aBox(bytes)
		);
	},
});
