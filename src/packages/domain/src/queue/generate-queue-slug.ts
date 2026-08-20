import { randomBytes } from "node:crypto";
import { type QueueSlug, QueueSlugSchema } from "./queue-name.schema";

export function generateQueueSlug(): QueueSlug {
	return QueueSlugSchema.parse(randomBytes(8).toString("hex"));
}
