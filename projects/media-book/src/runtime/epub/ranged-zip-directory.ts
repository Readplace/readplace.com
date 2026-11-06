export type ByteRange = { suffixLength: number } | { start: number; end: number };
export type ReadByteRange = (range: ByteRange) => Promise<Uint8Array | "staged-bytes-gone">;

export type ZipDirectoryEntry = { name: string; method: number; localHeaderOffset: number; compressedSize: number };

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const END_OF_CENTRAL_DIRECTORY_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const CENTRAL_DIRECTORY_HEADER_BYTES = 46;
export const ZIP_TAIL_BYTES = END_OF_CENTRAL_DIRECTORY_BYTES + MAX_ZIP_COMMENT_BYTES;

function viewOf(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function endOfCentralDirectoryAt(tail: Uint8Array): number {
	const view = viewOf(tail);
	for (let offset = tail.byteLength - END_OF_CENTRAL_DIRECTORY_BYTES; offset >= 0; offset -= 1) {
		if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
	}
	return -1;
}

function centralDirectoryEntries(directory: Uint8Array): ZipDirectoryEntry[] {
	const view = viewOf(directory);
	const decoder = new TextDecoder();
	const entries: ZipDirectoryEntry[] = [];
	let offset = 0;
	while (offset + CENTRAL_DIRECTORY_HEADER_BYTES <= directory.byteLength) {
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const nameStart = offset + CENTRAL_DIRECTORY_HEADER_BYTES;
		entries.push({
			name: decoder.decode(directory.subarray(nameStart, nameStart + nameLength)),
			method: view.getUint16(offset + 10, true),
			compressedSize: view.getUint32(offset + 20, true),
			localHeaderOffset: view.getUint32(offset + 42, true),
		});
		offset = nameStart + nameLength + extraLength + commentLength;
	}
	return entries;
}

export async function readRangedZipDirectory(readRange: ReadByteRange): Promise<ZipDirectoryEntry[] | "not-a-zip" | "staged-bytes-gone"> {
	const tail = await readRange({ suffixLength: ZIP_TAIL_BYTES });
	if (tail === "staged-bytes-gone") return tail;
	const endAt = endOfCentralDirectoryAt(tail);
	if (endAt === -1) return "not-a-zip";
	const end = viewOf(tail);
	const directorySize = end.getUint32(endAt + 12, true);
	const directoryOffset = end.getUint32(endAt + 16, true);
	if (directorySize === 0) return [];
	const directory = await readRange({ start: directoryOffset, end: directoryOffset + directorySize - 1 });
	if (directory === "staged-bytes-gone") return directory;
	return centralDirectoryEntries(directory);
}
