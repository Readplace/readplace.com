const COPY_BY_CODEC: Readonly<Record<string, string>> = {
	mp3: "mp3",
	aac: "m4a",
};

export function transcriptionInputExtension(codec: string): string {
	return COPY_BY_CODEC[codec] ?? "m4a";
}

export function transcriptionInputArgs(params: {
	url: string;
	etag: string;
	chargedSeconds: number;
	codec: string;
	outputPath: string;
}): string[] {
	const encode =
		params.codec in COPY_BY_CODEC
			? ["-c:a", "copy"]
			: ["-c:a", "aac", "-b:a", "64k", "-ac", "1"];
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
		...encode,
		params.outputPath,
	];
}
