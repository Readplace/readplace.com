import { z } from "zod";

export const ObjectSha256Schema = z
	.string()
	.regex(/^[0-9a-f]{64}$/)
	.brand<"ObjectSha256">();
export type ObjectSha256 = z.infer<typeof ObjectSha256Schema>;

export function objectKey(params: { sha256: ObjectSha256; generation: number }): string {
	return `objects/sha256/${params.sha256}/${params.generation}`;
}
