import { createHash } from "node:crypto";
import type { MediaWriteContext } from "./put-image-object.types";

export function mediaFilename(params: { sourceUrl: string; body: Buffer; extension: string; writeContext?: MediaWriteContext }): string {
	if (params.writeContext === undefined) return `${createHash("sha256").update(params.sourceUrl).digest("hex").slice(0, 16)}${params.extension}`;
	const scope = createHash("sha256").update(JSON.stringify([params.writeContext.attemptId, params.writeContext.authorUserId ?? null])).digest("hex");
	const body = createHash("sha256").update(JSON.stringify(params.sourceUrl)).update(params.body).digest("hex");
	return `attempts/${scope}/${body}${params.extension}`;
}
