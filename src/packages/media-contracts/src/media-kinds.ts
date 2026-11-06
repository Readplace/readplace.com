import { z } from "zod";
import { AUDIO } from "./kinds/audio";
import { BOOK } from "./kinds/book";
import type { MediaKindManifest } from "./media-kind";

export const MediaKindNameSchema = z.enum(["book", "audio"]);
export type MediaKindName = z.infer<typeof MediaKindNameSchema>;

export const MEDIA_KINDS: ReadonlyMap<MediaKindName, MediaKindManifest> =
	new Map<MediaKindName, MediaKindManifest>([
		["book", BOOK],
		["audio", AUDIO],
	]);
