import { z } from "zod";

export const MeteredLegSchema = z.enum([
	"render-residential-per-gb",
	"render-web-unlocker-fetch",
	"render-web-unlocker-render",
	"comprehensive",
	"content-judge",
	"summary",
]);
export type MeteredLeg = z.infer<typeof MeteredLegSchema>;

export const PaidLegPermitSchema = z
	.object({ leg: MeteredLegSchema, claimId: z.string(), inputHash: z.string() })
	.brand<"PaidLegPermit">();
export type PaidLegPermit = z.infer<typeof PaidLegPermitSchema>;

export type ClaimMeteredLeg = (p: {
	url: string;
	leg: MeteredLeg;
	inputHash: string;
	claimId: string;
	expiresAt: string;
}) => Promise<
	| { kind: "granted"; permit: PaidLegPermit }
	| { kind: "deferred" }
	| { kind: "settled"; outcome: string }
	| { kind: "in-flight" }
>;

export type SettleMeteredLeg = (p: {
	url: string;
	permit: PaidLegPermit;
	outcome: string;
	settledAt: string;
}) => Promise<void>;

export type ReleaseMeteredLeg = (p: { url: string; permit: PaidLegPermit }) => Promise<void>;
