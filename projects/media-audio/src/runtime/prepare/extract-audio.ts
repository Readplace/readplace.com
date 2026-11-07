import assert from "node:assert";
import type { initDynamoDbPrivateItemMedia } from "@packages/article-store";
import type { RefObject, UnrefAllForUpload } from "@packages/media-object-store";
import { enclosureArgs } from "./ffmpeg-args";
import type { PrepareStep, RunFfmpeg } from "./prepare-transcription-handler";
import type { HashFile, RemoveFile } from "./rendition-file";
import { firstAudioCodec, type ProbeFileDuration, type RunFfprobe } from "./run-ffprobe";

type PrivateItemMedia = ReturnType<typeof initDynamoDbPrivateItemMedia>;

const RENDITION_MEDIA_TYPE = "audio/mp4";

export function initExtractAudio(deps: {
	runFfprobe: RunFfprobe;
	runFfmpeg: RunFfmpeg;
	probeFileDuration: ProbeFileDuration;
	hashFile: HashFile;
	mediaObjects: { ref: RefObject; unrefAll: UnrefAllForUpload };
	setArticleEnclosure: PrivateItemMedia["setArticleEnclosure"];
	putLocalFile: (params: { key: string; path: string }) => Promise<void>;
	removeFile: RemoveFile;
	tmpDir: string;
}): PrepareStep {
	return async ({ detail, inputUrl }) => {
		const probed = await deps.runFfprobe({ url: inputUrl, etag: detail.etag });
		if (probed.outcome === "staged-bytes-gone") return probed.outcome;
		const codec = firstAudioCodec(probed.streams);
		assert(codec, `${detail.url} has no audio stream`);
		const path = `${deps.tmpDir}/${detail.uploadId}.m4a`;
		try {
			const written = await deps.runFfmpeg(
				enclosureArgs({ url: inputUrl, etag: detail.etag, chargedSeconds: detail.chargedSeconds, codec, outputPath: path }),
			);
			if (written === "staged-bytes-gone") return written;
			const { sha256, size } = await deps.hashFile(path);
			const held = await deps.mediaObjects.ref({
				sha256,
				uploadId: detail.uploadId,
				size,
				mediaType: RENDITION_MEDIA_TYPE,
				putBytes: (key) => deps.putLocalFile({ key, path }),
			});
			const { durationSeconds } = await deps.probeFileDuration({ file: path });
			const recorded = await deps.setArticleEnclosure({
				url: detail.url,
				enclosure: { object: held.key, mediaType: RENDITION_MEDIA_TYPE, durationSeconds: Math.ceil(durationSeconds) },
			});
			if (recorded === "not-found") {
				await deps.mediaObjects.unrefAll({ uploadId: detail.uploadId });
				return "row-gone";
			}
			return "proceed";
		} finally {
			await deps.removeFile(path);
		}
	};
}
