import assert from "node:assert";
import type { MediaUploadSession, ReadTimedDuration } from "@packages/domain";
import { type MediaKindManifest, type Meter, billableSeconds } from "@packages/media-contracts";
import type { ChargeTranscriptQuota, ChargedTranscript } from "@packages/provider-contracts/transcript-quota";
import { COMMIT_ATTEMPT } from "./commit-received-upload";
import type { UploadRefusalReason } from "./upload.refusal";

export type ChargeDecision =
	| { kind: "proceed"; chargedSeconds?: number; freshCharge?: ChargedTranscript }
	| { kind: "refuse"; reason: UploadRefusalReason };

export type ChargeTranscript = (params: {
	session: MediaUploadSession;
	kind: MediaKindManifest;
	etag: string;
}) => Promise<ChargeDecision>;

export function initChargeTranscript(deps: {
	readDurationByMeter: ReadonlyMap<Meter, ReadTimedDuration>;
	chargeTranscriptQuota: ChargeTranscriptQuota;
	allowanceSeconds: number;
}): ChargeTranscript {
	return async ({ session, kind, etag }) => {
		if (!session.metered || kind.meter === undefined) return { kind: "proceed" };
		const readDuration = deps.readDurationByMeter.get(kind.meter);
		assert(readDuration, `no duration reader for the ${kind.meter} meter`);
		const facts = await readDuration({ uploadId: session.uploadId, etag });
		if ("unreadable" in facts) return { kind: "refuse", reason: "unreadable-audio" };
		const refusal = kind.refuseTimedFacts(facts);
		if (refusal !== undefined) return { kind: "refuse", reason: refusal };
		const seconds = billableSeconds(facts.durationSeconds);
		if (seconds > deps.allowanceSeconds) return { kind: "refuse", reason: "transcript-too-long" };
		const ref = { userId: session.userId, uploadId: session.uploadId, attempt: COMMIT_ATTEMPT };
		const charge = await deps.chargeTranscriptQuota({ ...ref, seconds });
		switch (charge.outcome) {
			case "charged":
				return { kind: "proceed", chargedSeconds: seconds, freshCharge: { ...ref, seconds, day: charge.day } };
			case "already-charged":
				return { kind: "proceed", chargedSeconds: seconds };
			case "day-spent":
				return { kind: "refuse", reason: "transcript-quota" };
			case "over-allowance":
				return { kind: "refuse", reason: "transcript-too-long" };
		}
	};
}
