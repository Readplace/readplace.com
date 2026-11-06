import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { type ObjectSha256, ObjectSha256Schema } from "@packages/media-object-store";

export type HashFile = (path: string) => Promise<{ sha256: ObjectSha256; size: number }>;
export type RemoveFile = (path: string) => Promise<void>;

export const hashFile: HashFile = async (path) => {
	const hash = createHash("sha256");
	let size = 0;
	await pipeline(createReadStream(path), async (chunks: AsyncIterable<Buffer>) => {
		for await (const chunk of chunks) {
			hash.update(chunk);
			size += chunk.length;
		}
	});
	return { sha256: ObjectSha256Schema.parse(hash.digest("hex")), size };
};

export const removeFile: RemoveFile = (path) => rm(path, { force: true });
