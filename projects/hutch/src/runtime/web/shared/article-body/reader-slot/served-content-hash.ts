import { createHash } from "node:crypto";

export function servedContentHash(normalisedText: string): string {
	return createHash("sha256").update(normalisedText).digest("hex");
}
