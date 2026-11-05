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

export function readZipEntry(params: { bytes: Uint8Array; name: string }): string | undefined {
	const entries = unzipSync(params.bytes, { filter: (file) => file.name === params.name });
	const entry = entries[params.name];
	return entry === undefined ? undefined : strFromU8(entry);
}
