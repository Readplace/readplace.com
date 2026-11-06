import { z } from "zod";

export const EnclosureSchema = z.object({
	object: z.string().regex(/^objects\/sha256\/[0-9a-f]{64}\/\d+$/),
	mediaType: z.enum(["audio/mpeg", "audio/mp4"]),
	durationSeconds: z.number().int().positive(),
});
export type Enclosure = z.infer<typeof EnclosureSchema>;
