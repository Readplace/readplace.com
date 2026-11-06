import { strFromU8, unzipSync } from "fflate";

export function listZipEntries(bytes: Uint8Array): string[] {
	const names: string[] = [];
	unzipSync(bytes, {
		filter: (file) => {
			names.push(file.name);
			return false;
		},
	});
	return names;
}

export function readZipEntryBytes(params: { bytes: Uint8Array; name: string }): Uint8Array | undefined {
	return unzipSync(params.bytes, { filter: (file) => file.name === params.name })[params.name];
}

export function readZipEntry(params: { bytes: Uint8Array; name: string }): string | undefined {
	const entry = readZipEntryBytes(params);
	return entry === undefined ? undefined : strFromU8(entry);
}
