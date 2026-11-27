import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { z } from "zod";
import { HandPickedScopeSchema } from "./built-in-readlists";

export const ReadlistSlugsSchema = z.union([
	ReadlistSlugSchema.transform((slug) => [slug]),
	z.array(ReadlistSlugSchema).min(1),
]);

export const ReadlistDestinationSchema = z.union([ReadlistSlugSchema, HandPickedScopeSchema]);
export const ReadlistDestinationsSchema = z.union([
	ReadlistDestinationSchema.transform((slug) => [slug]),
	z.array(ReadlistDestinationSchema).min(1),
]);
