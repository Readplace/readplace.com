import { randomBytes } from "node:crypto";
import { type ReadlistSlug, ReadlistSlugSchema } from "./readlist-name.schema";

export function generateReadlistSlug(): ReadlistSlug {
	return ReadlistSlugSchema.parse(randomBytes(8).toString("hex"));
}
