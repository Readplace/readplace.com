import type { MediaKindName } from "@packages/media-contracts";
import { z } from "zod";

export const MEDIA_AUDIO_KINDS = ["audio", "video"] as const satisfies readonly MediaKindName[];
export const MediaAudioKindSchema = z.enum(MEDIA_AUDIO_KINDS);
export type MediaAudioKind = z.infer<typeof MediaAudioKindSchema>;
export const KEPT_ORIGINAL_KINDS = ["audio"] as const satisfies readonly MediaAudioKind[];
