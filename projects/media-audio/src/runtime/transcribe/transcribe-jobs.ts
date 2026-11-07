/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	BadRequestException,
	ConflictException,
	GetTranscriptionJobCommand,
	NotFoundException,
	StartTranscriptionJobCommand,
	type TranscribeClient,
} from "@aws-sdk/client-transcribe";
import type { StartTranscriptionJob } from "../prepare/prepare-transcription-handler";

const MAX_SPEAKER_LABELS = 10;

export function initTranscribeJobs(deps: {
	client: TranscribeClient;
	bucketName: string;
}) {
	const startTranscriptionJob: StartTranscriptionJob = async ({
		jobName,
		mediaFileKey,
		outputKey,
	}) => {
		await deps.client
			.send(
				new StartTranscriptionJobCommand({
					TranscriptionJobName: jobName,
					Media: { MediaFileUri: `s3://${deps.bucketName}/${mediaFileKey}` },
					OutputBucketName: deps.bucketName,
					OutputKey: outputKey,
					IdentifyLanguage: true,
					Settings: {
						ShowSpeakerLabels: true,
						MaxSpeakerLabels: MAX_SPEAKER_LABELS,
					},
				}),
			)
			.catch((error: unknown) => {
				if (error instanceof ConflictException) return;
				throw error;
			});
	};

	const getTranscriptionJob = async ({
		jobName,
	}: {
		jobName: string;
	}): Promise<"found" | "not-found"> =>
		deps.client
			.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }))
			.then(
				() => "found" as const,
				(error: unknown) => {
					if (error instanceof NotFoundException) return "not-found" as const;
					if (
						error instanceof BadRequestException &&
						/couldn't be found/.test(error.message)
					)
						return "not-found" as const;
					throw error;
				},
			);

	return { startTranscriptionJob, getTranscriptionJob };
}
/* c8 ignore stop */
