import assert from "node:assert";
import type { MediaKindName } from "./media-kinds";

export type MediaKindManifest = Readonly<{
	name: MediaKindName;
	label: string;
	accepts: Readonly<Record<string, readonly string[]>>;
	uploadCeilingBytes: number;
	ceilingLabel: string;
	sniff: (firstBytes: Uint8Array) => boolean;
}>;

export function defineMediaKind(manifest: MediaKindManifest): MediaKindManifest {
	assert(Object.keys(manifest.accepts).length > 0, `${manifest.name} accepts no media type`);
	assert(manifest.uploadCeilingBytes > 0, `${manifest.name} needs a positive upload ceiling`);
	return Object.freeze({ ...manifest });
}
