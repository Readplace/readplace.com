import { z } from "zod";

export const TranscriptChargeStateSchema = z.enum(["reserved", "started", "settled", "refunded"]);
export type TranscriptChargeState = z.infer<typeof TranscriptChargeStateSchema>;

export type TranscriptChargeRef = { userId: string; uploadId: string; attempt: number };

export type ChargedTranscript = TranscriptChargeRef & { seconds: number; day: string };

export type ChargeTranscriptQuota = (p: TranscriptChargeRef & { seconds: number }) => Promise<
	| { outcome: "charged"; day: string }
	| { outcome: "already-charged" }
	| { outcome: "day-spent" }
	| { outcome: "over-allowance" }
>;

export type MarkTranscriptStarted = (
	p: TranscriptChargeRef,
) => Promise<{ outcome: "done" } | { outcome: "closed" }>;

export type SettleTranscriptCharge = (
	p: TranscriptChargeRef,
) => Promise<{ outcome: "done" } | { outcome: "closed" }>;

export type RefundTranscriptCharge = (
	p: ChargedTranscript,
) => Promise<{ outcome: "refunded" } | { outcome: "closed" }>;

export type RefundUnstartedCharge = (
	p: ChargedTranscript,
) => Promise<{ outcome: "refunded" } | { outcome: "started" } | { outcome: "closed" }>;

export type DeleteAllTranscriptQuota = (p: { userId: string }) => Promise<void>;
