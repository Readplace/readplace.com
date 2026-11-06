import {
	mintPrivateItemUrl,
	type PrivateItemUrl,
} from "@packages/media-contracts";
import type { SettleTranscriptCharge } from "@packages/provider-contracts";
import {
	type JobRequest,
	jobRequestKey,
	parseTranscriptionJobName,
	transcriptsKeyPrefix,
} from "../prepare/transcription-keys";

export type ReadJobRequest = (params: {
	key: string;
}) => Promise<JobRequest | undefined>;

export type FindArticleMedia = (params: {
	url: string;
}) => Promise<{ media?: { fileName: string } } | undefined>;

export type TranscriptJob = ReturnType<typeof parseTranscriptionJobName>;

export type FindReleasedTranscript = (params: { jobName: string }) => Promise<
	| { outcome: "released" }
	| {
			outcome: "present";
			job: TranscriptJob;
			url: PrivateItemUrl;
			request: JobRequest;
		}
>;

export function initFindReleasedTranscript(deps: {
	readJobRequest: ReadJobRequest;
	findArticleMedia: FindArticleMedia;
	settleTranscriptCharge: SettleTranscriptCharge;
	deletePrefix: (prefix: string) => Promise<void>;
}): FindReleasedTranscript {
	return async ({ jobName }) => {
		const job = parseTranscriptionJobName(jobName);
		const prefix = transcriptsKeyPrefix(job.uploadId);
		const request = await deps.readJobRequest({ key: jobRequestKey(job) });
		if (request === undefined) {
			await deps.deletePrefix(prefix);
			return { outcome: "released" };
		}
		const url = mintPrivateItemUrl(job.uploadId);
		const item = await deps.findArticleMedia({ url });
		if (item?.media === undefined) {
			await deps.settleTranscriptCharge({ userId: request.userId, ...job });
			await deps.deletePrefix(prefix);
			return { outcome: "released" };
		}
		return { outcome: "present", job, url, request };
	};
}
