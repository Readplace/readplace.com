type TranscriptionInputFormat = {
	extension: string;
	mediaType: "audio/mpeg" | "audio/mp4";
};

const M4A: TranscriptionInputFormat = { extension: "m4a", mediaType: "audio/mp4" };

const COPY_BY_CODEC: Readonly<Record<string, TranscriptionInputFormat>> = {
	mp3: { extension: "mp3", mediaType: "audio/mpeg" },
	aac: M4A,
};

export function transcriptionInputFormat(codec: string): TranscriptionInputFormat {
	return COPY_BY_CODEC[codec] ?? M4A;
}

const ENCLOSURE_COPY_CODECS: ReadonlySet<string> = new Set(["aac"]);
const COPY = ["-c:a", "copy"];
const AAC_64K_MONO = ["-c:a", "aac", "-b:a", "64k", "-ac", "1"];

type StagedAudioRead = {
	url: string;
	etag: string;
	chargedSeconds: number;
	codec: string;
	outputPath: string;
};

export function transcriptionInputArgs(params: StagedAudioRead): string[] {
	return [
		...stagedAudioInputArgs(params),
		...(params.codec in COPY_BY_CODEC ? COPY : AAC_64K_MONO),
		params.outputPath,
	];
}

export function enclosureArgs(params: StagedAudioRead): string[] {
	return [
		...stagedAudioInputArgs(params),
		...(ENCLOSURE_COPY_CODECS.has(params.codec) ? COPY : AAC_64K_MONO),
		params.outputPath,
	];
}

function stagedAudioInputArgs(params: StagedAudioRead): string[] {
	return [
		"-nostdin",
		"-y",
		"-v",
		"warning",
		"-headers",
		`If-Match: ${params.etag}\r\n`,
		"-i",
		params.url,
		"-vn",
		"-map",
		"0:a:0",
		"-t",
		String(params.chargedSeconds),
	];
}
