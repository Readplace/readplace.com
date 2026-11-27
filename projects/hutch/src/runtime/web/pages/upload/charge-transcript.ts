import assert from "node:assert";
import type { MediaUploadSession, ReadTimedDuration } from "@packages/domain";
import {
	type MediaKindManifest,
	type Meter,
	type TimedFactsRefusal,
	type TimedMediaFacts,
	billableSeconds,
} from "@packages/media-contracts";
import type { ChargeTranscriptQuota, ChargedTranscript } from "@packages/provider-contracts/transcript-quota";
import { COMMIT_ATTEMPT, type TranscriptCharge } from "./commit-received-upload";
import type { TranscriptRefusalReason } from "./upload.refusal";

export type ChargeDecision =
	| { kind: "proceed"; charge?: TranscriptCharge; freshCharge?: ChargedTranscript }
	| { kind: "refuse"; reason: TranscriptRefusalReason };

export type ChargeTranscript = (params: {
	session: MediaUploadSession;
	kind: MediaKindManifest;
	etag: string;
}) => Promise<ChargeDecision>;

function refusalOfLowerBound(p: {
	atLeastSeconds: number;
	allowanceSeconds: number;
}): "transcript-too-long" | "unreadable-audio" {
	return billableSeconds(p.atLeastSeconds) > p.allowanceSeconds ? "transcript-too-long" : "unreadable-audio";
}

export type TimedRefusal =
	| { kind: "refuse"; reason: TranscriptRefusalReason }
	| { kind: "timed"; durationSeconds: number };

export function timedRefusalOf(p: {
	facts: Awaited<ReturnType<ReadTimedDuration>>;
	kind: { refuseTimedFacts: (facts: TimedMediaFacts) => TimedFactsRefusal | undefined };
	allowanceSeconds: number;
}): TimedRefusal {
	const { facts } = p;
	if ("unreadable" in facts) return { kind: "refuse", reason: "unreadable-audio" };
	if ("atLeastSeconds" in facts)
		return {
			kind: "refuse",
			reason: refusalOfLowerBound({ atLeastSeconds: facts.atLeastSeconds, allowanceSeconds: p.allowanceSeconds }),
		};
	const refusal = p.kind.refuseTimedFacts(facts);
	if (refusal !== undefined) return { kind: "refuse", reason: refusal };
	return { kind: "timed", durationSeconds: facts.durationSeconds };
}

export function initChargeTranscript(deps: {
	readDurationByMeter: ReadonlyMap<Meter, ReadTimedDuration>;
	chargeTranscriptQuota: ChargeTranscriptQuota;
	allowanceSeconds: number;
}): ChargeTranscript {
	return async ({ session, kind, etag }) => {
		if (kind.meter === undefined) return { kind: "proceed" };
		const readDuration = deps.readDurationByMeter.get(kind.meter);
		assert(readDuration, `no duration reader for the ${kind.meter} meter`);
		const facts = await readDuration({ uploadId: session.uploadId, etag });
		const timed = timedRefusalOf({ facts, kind, allowanceSeconds: deps.allowanceSeconds });
		if (timed.kind === "refuse") return timed;
		const seconds = billableSeconds(timed.durationSeconds);
		if (seconds > deps.allowanceSeconds) return { kind: "refuse", reason: "transcript-too-long" };
		const ref = { userId: session.userId, uploadId: session.uploadId, attempt: COMMIT_ATTEMPT };
		const charge = await deps.chargeTranscriptQuota({ ...ref, seconds });
		switch (charge.outcome) {
			case "charged":
				return { kind: "proceed", charge: { seconds, day: charge.day }, freshCharge: { ...ref, seconds, day: charge.day } };
			case "already-charged":
				return { kind: "proceed", charge: { seconds, day: charge.day } };
			case "day-spent":
				return { kind: "refuse", reason: "transcript-quota" };
			case "over-allowance":
				return { kind: "refuse", reason: "transcript-too-long" };
		}
	};
}
