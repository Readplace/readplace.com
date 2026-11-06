import type { ByteRange, ReadByteRange } from "./ranged-zip-directory";

export function readRangesOf(bytes: Uint8Array): { readRange: ReadByteRange; ranges: ByteRange[] } {
	const ranges: ByteRange[] = [];
	const readRange: ReadByteRange = async (range) => {
		ranges.push(range);
		return "suffixLength" in range ? bytes.slice(Math.max(0, bytes.byteLength - range.suffixLength)) : bytes.slice(range.start, range.end + 1);
	};
	return { readRange, ranges };
}
