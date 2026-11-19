import { displayMinutes } from "@packages/media-contracts";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchIntegrations } from "@packages/translations/hutch-integrations";
import { type LocalTime, toAbsoluteDateTime } from "@packages/web-shell";
import { z } from "zod";

const { t } = translator(hutchIntegrations, DEFAULT_LOCALE);

const TranscriptRefusalReasonSchema = z.enum([
	"transcript-quota",
	"transcript-too-long",
	"unreadable-audio",
	"no-audio-track",
]);
export type TranscriptRefusalReason = z.infer<typeof TranscriptRefusalReasonSchema>;
export type UploadRefusalReason = TranscriptRefusalReason | "book-quota";

export type UploadRefusal =
	| { reason: TranscriptRefusalReason; message: string }
	| { reason: "book-quota"; retryAt: LocalTime };

const TranscriptRefusalQuery = z.object({ refused: TranscriptRefusalReasonSchema });
const BookQuotaQuery = z.object({ refused: z.literal("book-quota"), retry_at: z.string().datetime() });

export function uploadRefusalCopyOf(allowanceSeconds: number): Record<TranscriptRefusalReason, string> {
	const minutes = displayMinutes(allowanceSeconds);
	return {
		"transcript-quota": `You've used your ${minutes} minutes of transcript for today. It resets at 00:00 UTC.`,
		"transcript-too-long": `This file is longer than your ${minutes} minutes of transcript a day. Split it into parts of ${minutes} minutes or less.`,
		"unreadable-audio": "Readplace couldn't read this audio file. Upload an MP3 or M4A that plays on your device.",
		"no-audio-track": "This video has no sound, so there's nothing to transcribe.",
	};
}

export function bookQuotaMessageOf(retryAt: Date): string {
	const label = toAbsoluteDateTime({ iso: retryAt.toISOString() }).label;
	return `${t("upload.refusal.bookQuota.before")} ${label}${t("upload.refusal.bookQuota.after")}`;
}

export function bookQuotaRedirectQueryOf(retryAt: Date): string {
	return `refused=book-quota&retry_at=${encodeURIComponent(retryAt.toISOString())}`;
}

export function uploadRefusalOf(params: {
	query: Readonly<Record<string, unknown>>;
	allowanceSeconds: number;
}): UploadRefusal | undefined {
	const bookQuota = BookQuotaQuery.safeParse(params.query);
	if (bookQuota.success) return { reason: "book-quota", retryAt: toAbsoluteDateTime({ iso: bookQuota.data.retry_at }) };
	const transcript = TranscriptRefusalQuery.safeParse(params.query);
	if (!transcript.success) return undefined;
	return {
		reason: transcript.data.refused,
		message: uploadRefusalCopyOf(params.allowanceSeconds)[transcript.data.refused],
	};
}
