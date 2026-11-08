import { displayMinutes } from "@packages/media-contracts";
import { z } from "zod";

const UploadRefusalReasonSchema = z.enum(["transcript-quota", "transcript-too-long", "unreadable-audio", "no-audio-track"]);
export type UploadRefusalReason = z.infer<typeof UploadRefusalReasonSchema>;

export function uploadRefusalCopyOf(allowanceSeconds: number): Record<UploadRefusalReason, string> {
	const minutes = displayMinutes(allowanceSeconds);
	return {
		"transcript-quota": `You've used your ${minutes} minutes of transcript for today. It resets at 00:00 UTC.`,
		"transcript-too-long": `This file is longer than your ${minutes} minutes of transcript a day. Split it into parts of ${minutes} minutes or less.`,
		"unreadable-audio": "Readplace couldn't read this audio file. Upload an MP3 or M4A that plays on your device.",
		"no-audio-track": "This video has no sound, so there's nothing to transcribe.",
	};
}

export function uploadRefusalMessage(params: {
	query: Readonly<Record<string, unknown>>;
	allowanceSeconds: number;
}): string | undefined {
	const reason = UploadRefusalReasonSchema.safeParse(params.query.refused);
	return reason.success ? uploadRefusalCopyOf(params.allowanceSeconds)[reason.data] : undefined;
}
