import { inflateRawSync } from "node:zlib";
import type { ReadByteRange, ZipDirectoryEntry } from "./ranged-zip-directory";

const LOCAL_HEADER_BYTES = 30;
const MAX_LOCAL_NAME_AND_EXTRA_BYTES = 2 * 0xffff;
const STORED = 0;

export async function readRangedZipEntry(params: { readRange: ReadByteRange; entry: ZipDirectoryEntry }): Promise<Uint8Array | "staged-bytes-gone"> {
	const { entry } = params;
	const read = await params.readRange({
		start: entry.localHeaderOffset,
		end: entry.localHeaderOffset + LOCAL_HEADER_BYTES + MAX_LOCAL_NAME_AND_EXTRA_BYTES + entry.compressedSize - 1,
	});
	if (read === "staged-bytes-gone") return read;
	const view = new DataView(read.buffer, read.byteOffset, read.byteLength);
	const dataStart = LOCAL_HEADER_BYTES + view.getUint16(26, true) + view.getUint16(28, true);
	const data = read.subarray(dataStart, dataStart + entry.compressedSize);
	return entry.method === STORED ? data : new Uint8Array(inflateRawSync(data));
}
