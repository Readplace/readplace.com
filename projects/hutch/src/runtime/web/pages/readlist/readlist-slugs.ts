import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { z } from "zod";

export const ReadlistSlugsSchema = z.union([
	ReadlistSlugSchema.transform((slug) => [slug]),
	z.array(ReadlistSlugSchema).min(1),
]);
