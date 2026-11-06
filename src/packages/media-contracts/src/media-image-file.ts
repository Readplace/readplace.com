import { z } from "zod";

const MEDIA_IMAGE_EXTENSION_BY_MEDIA_TYPE: ReadonlyMap<string, string> = new Map([
	["image/jpeg", "jpg"],
	["image/png", "png"],
	["image/gif", "gif"],
	["image/webp", "webp"],
	["image/avif", "avif"],
	["image/svg+xml", "svg"],
]);

const ALLOWED_EXTENSIONS = [...MEDIA_IMAGE_EXTENSION_BY_MEDIA_TYPE.values()].join("|");

export const MediaImageFileSchema = z
	.string()
	.regex(new RegExp(`^[0-9a-f]{64}\\.(${ALLOWED_EXTENSIONS})$`))
	.brand<"MediaImageFile">();
export type MediaImageFile = z.infer<typeof MediaImageFileSchema>;

export function mediaImageFileOf(image: { sha256Hex: string; mediaType: string }): MediaImageFile | undefined {
	const extension = MEDIA_IMAGE_EXTENSION_BY_MEDIA_TYPE.get(image.mediaType);
	return extension === undefined ? undefined : MediaImageFileSchema.parse(`${image.sha256Hex}.${extension}`);
}
