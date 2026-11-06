import type { Readable } from "node:stream";
import { CouldNotDetermineFileTypeError, parseStream, UnsupportedFileTypeError } from "music-metadata";

export type AudioStreamFacts = {
	container: string | undefined;
	codec: string | undefined;
	duration: number | undefined;
	hasAudio: boolean;
	hasVideo: boolean;
	title: string | undefined;
};

export type ParseAudioStream = (stream: Readable, fileInfo: { size: number }) => Promise<AudioStreamFacts | "unrecognised">;

export const parseAudioStream: ParseAudioStream = async (stream, fileInfo) => {
	try {
		const { format, common } = await parseStream(stream, fileInfo, { duration: true, skipCovers: true });
		return {
			container: format.container,
			codec: format.codec,
			duration: format.duration,
			hasAudio: format.hasAudio === true,
			hasVideo: format.hasVideo === true,
			title: common.title,
		};
	} catch (error) {
		if (error instanceof CouldNotDetermineFileTypeError || error instanceof UnsupportedFileTypeError) return "unrecognised";
		throw error;
	}
};
