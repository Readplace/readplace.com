import { z } from "zod";

const UploadRefusalReasonSchema = z.enum(["transcript-quota", "transcript-too-long", "unreadable-audio"]);
export type UploadRefusalReason = z.infer<typeof UploadRefusalReasonSchema>;

export const UPLOAD_REFUSAL_COPY: Record<UploadRefusalReason, string> = {
	"transcript-quota": "Your limit of 20 minutes of transcript has been reached. It resets at 00:00 UTC.",
	"transcript-too-long":
		"This file is longer than your 20 minutes of transcript a day. Split it into parts of 20 minutes or less and upload them one at a time.",
	"unreadable-audio": "We couldn't read this audio file. Upload an MP3 or M4A that plays on your device.",
};

export function uploadRefusalMessage(query: Readonly<Record<string, unknown>>): string | undefined {
	const reason = UploadRefusalReasonSchema.safeParse(query.refused);
	return reason.success ? UPLOAD_REFUSAL_COPY[reason.data] : undefined;
}
