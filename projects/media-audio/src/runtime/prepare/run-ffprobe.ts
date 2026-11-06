import { z } from "zod";
import type { RunFfmpeg } from "./prepare-transcription-handler";

const ProbeOutputSchema = z.object({
	streams: z.array(
		z.object({ codec_type: z.string(), codec_name: z.string() }),
	),
});
type ProbedStream = z.infer<typeof ProbeOutputSchema>["streams"][number];

export type ExecFile = (
	file: string,
	args: string[],
) => Promise<{ stdout: string; stderr: string }>;
export type RunFfprobe = (params: {
	url: string;
	etag: string;
}) => Promise<
	| { outcome: "read"; streams: ProbedStream[] }
	| { outcome: "staged-bytes-gone" }
>;

const STAGED_BYTES_GONE = /HTTP error (412|404)/;

export function isStagedBytesGone(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"stderr" in error &&
		typeof error.stderr === "string" &&
		STAGED_BYTES_GONE.test(error.stderr)
	);
}

export function initRunFfprobe(deps: { execFile: ExecFile }): RunFfprobe {
	return async ({ url, etag }) => {
		const args = [
			"-v",
			"warning",
			"-headers",
			`If-Match: ${etag}\r\n`,
			"-show_entries",
			"stream=codec_type,codec_name",
			"-of",
			"json",
			url,
		];
		const result = await deps
			.execFile("ffprobe", args)
			.catch((error: unknown) => {
				if (isStagedBytesGone(error)) return "staged-bytes-gone" as const;
				throw error;
			});
		if (result === "staged-bytes-gone") return { outcome: result };
		return {
			outcome: "read",
			streams: ProbeOutputSchema.parse(JSON.parse(result.stdout)).streams,
		};
	};
}

const DurationOutputSchema = z.object({
	format: z.object({ duration: z.coerce.number() }),
});

export type ProbeFileDuration = (params: {
	file: string;
}) => Promise<{ durationSeconds: number }>;

export function initProbeFileDuration(deps: {
	execFile: ExecFile;
}): ProbeFileDuration {
	return async ({ file }) => {
		const { stdout } = await deps.execFile("ffprobe", [
			"-v",
			"warning",
			"-show_entries",
			"format=duration",
			"-of",
			"json",
			file,
		]);
		return {
			durationSeconds: DurationOutputSchema.parse(JSON.parse(stdout)).format
				.duration,
		};
	};
}

export function firstAudioCodec(streams: ProbedStream[]): string | undefined {
	return streams.find((stream) => stream.codec_type === "audio")?.codec_name;
}

export function initRunFfmpeg(deps: { execFile: ExecFile }): RunFfmpeg {
	return async (args) =>
		deps.execFile("ffmpeg", args).then(
			() => "written" as const,
			(error: unknown) => {
				if (isStagedBytesGone(error)) return "staged-bytes-gone" as const;
				throw error;
			},
		);
}
