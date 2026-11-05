import type { MediaKindManifest, MediaKindName } from "@packages/media-contracts";

export interface UploadStartViewModel {
	readonly contentTypes: readonly string[];
	readonly ceilingLabel: string;
}

export function toUploadStartViewModel(kinds: ReadonlyMap<MediaKindName, MediaKindManifest>): UploadStartViewModel {
	const manifests = [...kinds.values()];
	return {
		contentTypes: manifests.flatMap((kind) => Object.keys(kind.accepts)),
		ceilingLabel: manifests.map((kind) => `${kind.label}: up to ${kind.ceilingLabel}`).join(", "),
	};
}

export function acceptAttributeOf(kind: MediaKindManifest): string {
	return Object.values(kind.accepts).flat().join(",");
}
