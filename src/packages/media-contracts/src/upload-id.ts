import { z } from "zod";

export const UploadIdSchema = z
	.string()
	.regex(/^[0-9a-f]{32}$/)
	.brand<"UploadId">();
export type UploadId = z.infer<typeof UploadIdSchema>;

export function mintUploadId(randomBytes: (size: number) => Uint8Array): UploadId {
	return UploadIdSchema.parse(Buffer.from(randomBytes(16)).toString("hex"));
}
