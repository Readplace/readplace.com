import { createHash } from "node:crypto";
import { z } from "zod";

export const ReadlistPurposeVersionSchema = z
	.string()
	.regex(/^[0-9a-f]{12}$/)
	.brand<"ReadlistPurposeVersion">();
export type ReadlistPurposeVersion = z.infer<typeof ReadlistPurposeVersionSchema>;

export function readlistPurposeVersion(text: string): ReadlistPurposeVersion {
	return ReadlistPurposeVersionSchema.parse(createHash("sha256").update(text).digest("hex").slice(0, 12));
}
