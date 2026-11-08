import type { ReadTimedDuration } from "@packages/domain";
import type { IFormat } from "music-metadata";
import { z } from "zod";

const UnreadableFileTypeError = z.object({
	name: z.enum(["CouldNotDetermineFileTypeError", "UnsupportedFileTypeError"]),
});

export async function timedFactsOfMetadata(
	metadata: Promise<{ format: Pick<IFormat, "duration" | "hasAudio" | "hasVideo"> }>,
): Promise<Awaited<ReturnType<ReadTimedDuration>>> {
	try {
		const { format } = await metadata;
		if (format.duration === undefined) return { unreadable: true };
		return { durationSeconds: format.duration, hasAudio: format.hasAudio === true, hasVideo: format.hasVideo === true };
	} catch (error) {
		if (UnreadableFileTypeError.safeParse(error).success) return { unreadable: true };
		throw error;
	}
}
