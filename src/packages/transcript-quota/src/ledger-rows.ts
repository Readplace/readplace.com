import { type TranscriptChargeRef, TranscriptChargeStateSchema } from "@packages/provider-contracts/transcript-quota";
import { z } from "zod";

const DAY_SECONDS = 24 * 60 * 60;
const DAY_ROW_LIFETIME_SECONDS = 2 * DAY_SECONDS;
const CHARGE_ROW_LIFETIME_SECONDS = 14 * DAY_SECONDS;

export const LedgerKeySchema = z.object({ pk: z.string(), sk: z.string() });

const ChargeRowSchema = z.object({
	pk: z.string(),
	sk: z.string(),
	seconds: z.number().int().positive(),
	state: TranscriptChargeStateSchema,
	day: z.string(),
	chargedAt: z.string(),
	expiresAt: z.number(),
});

export function quotaPk(userId: string): string {
	return `quota#${userId}`;
}

function dayOf(now: Date): string {
	return now.toISOString().slice(0, 10);
}

export function dayRowKey(p: { userId: string; day: string }): { pk: string; sk: string } {
	return { pk: quotaPk(p.userId), sk: `day#${p.day}` };
}

export function dayRowExpiresAt(day: string): number {
	return Date.parse(`${day}T00:00:00.000Z`) / 1000 + DAY_ROW_LIFETIME_SECONDS;
}

export function chargeRowKey(ref: TranscriptChargeRef): { pk: string; sk: string } {
	return { pk: quotaPk(ref.userId), sk: `charge#${ref.uploadId}#${ref.attempt}` };
}

export function chargeRowOf(p: TranscriptChargeRef & { seconds: number; now: Date }) {
	return ChargeRowSchema.parse({
		...chargeRowKey(p),
		seconds: p.seconds,
		state: "reserved",
		day: dayOf(p.now),
		chargedAt: p.now.toISOString(),
		expiresAt: Math.floor(p.now.getTime() / 1000) + CHARGE_ROW_LIFETIME_SECONDS,
	});
}
