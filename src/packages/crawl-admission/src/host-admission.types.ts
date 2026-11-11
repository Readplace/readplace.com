import { z } from "zod";
import type { NormalizedHost } from "./routing-policy";

export const HostAdmissionOwnerTokenSchema = z.string().min(1).brand<"HostAdmissionOwnerToken">();
export type HostAdmissionOwnerToken = z.infer<typeof HostAdmissionOwnerTokenSchema>;

export type HostAdmissionLease = {
	host: NormalizedHost;
	ownerToken: HostAdmissionOwnerToken;
	leaseExpiresAt: Date;
};

export type HostAdmissionDeferralReason = "host-busy" | "start-spacing" | "cooldown";

export type HostAdmissionOutcome =
	| { kind: "admitted"; lease: HostAdmissionLease }
	| { kind: "deferred"; reason: HostAdmissionDeferralReason; nextEligibleAt: Date }
	| { kind: "store-unavailable"; error: unknown };

export type AdmitHost = (request: {
	host: NormalizedHost;
	ownerToken: HostAdmissionOwnerToken;
	invocationHardDeadline: Date;
}) => Promise<HostAdmissionOutcome>;

export type ReleaseHostAdmission = (lease: {
	host: NormalizedHost;
	ownerToken: HostAdmissionOwnerToken;
}) => Promise<{ kind: "released" } | { kind: "not-owner" } | { kind: "store-unavailable"; error: unknown }>;

export type RecordHostCooldown = (cooldown: {
	host: NormalizedHost;
	cooldownUntil: Date;
}) => Promise<
	| { kind: "recorded" }
	| { kind: "kept-later-cooldown" }
	| { kind: "store-unavailable"; error: unknown }
>;
