import { MediaKindNameSchema } from "@packages/media-contracts";
import { z } from "zod";
import { ReaderArticleHashIdSchema } from "./reader-article-hash-id";

export const ItemMediaSchema = z.object({
	kind: MediaKindNameSchema,
	fileName: z.string(),
	routeId: ReaderArticleHashIdSchema,
	sectionCount: z.number().int().nonnegative().optional(),
});
export type ItemMedia = z.infer<typeof ItemMediaSchema>;
