import { z } from "zod";
import { BOOK } from "./kinds/book";
import type { MediaKindManifest } from "./media-kind";

export const MediaKindNameSchema = z.enum(["book"]);
export type MediaKindName = z.infer<typeof MediaKindNameSchema>;

export const MEDIA_KINDS: ReadonlyMap<MediaKindName, MediaKindManifest> = new Map([["book", BOOK]]);
