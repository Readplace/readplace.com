import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const OAuthGrantId = z.string().brand<"OAuthGrantId">();
export type OAuthGrantId = z.infer<typeof OAuthGrantId>;
export const CredentialFingerprint = z.string().brand<"CredentialFingerprint">();
export type CredentialFingerprint = z.infer<typeof CredentialFingerprint>;
export const RefreshRefusalId = z.string().min(1).brand<"RefreshRefusalId">();
export type RefreshRefusalId = z.infer<typeof RefreshRefusalId>;
export const RefreshAttempt = z.object({
	refusalId: RefreshRefusalId,
	occurredAt: z.number().int(),
	fingerprint: CredentialFingerprint,
});
export type RefreshAttempt = z.infer<typeof RefreshAttempt>;
export type RevocationCause = "rotation" | "logout" | "logout-all" | "account-deletion";
export const CredentialHistory = z.object({
	pk: z.string(),
	grantId: OAuthGrantId,
	fingerprint: CredentialFingerprint,
	credentialExpiresAt: z.number(),
	expiresAt: z.number(),
	parentFingerprint: CredentialFingerprint.optional(),
	revocation: z.object({ cause: z.enum(["rotation", "logout", "logout-all", "account-deletion"]), completedAt: z.number() }).optional(),
});
export type CredentialHistory = z.infer<typeof CredentialHistory>;
export interface RefreshContext {
	attempt?: RefreshAttempt;
	credential?: CredentialHistory;
	reason?: string;
	revocationCause?: RevocationCause;
	recoveryProof?: string;
}
export const refreshContext = new AsyncLocalStorage<RefreshContext>();

export function initRefreshProof(secret: string) {
	const hmac = (input: { purpose: string; value: string }) => createHmac("sha256", secret).update(`${input.purpose}\0${input.value}`).digest("hex");
	const fingerprint = (credential: string) => CredentialFingerprint.parse(hmac({ purpose: "oauth-credential", value: credential }));
	return {
		fingerprint,
		attempt: (credential: string, occurredAt: number): RefreshAttempt => ({ refusalId: RefreshRefusalId.parse(randomUUID()), occurredAt, fingerprint: fingerprint(credential) }),
		sign(attempt: RefreshAttempt): string {
			const payload = Buffer.from(JSON.stringify(attempt)).toString("base64url");
			return `${payload}.${hmac({ purpose: "oauth-recovery", value: payload })}`;
		},
		verify(proof: string): RefreshAttempt | undefined {
			const [payload, signature, extra] = proof.split(".");
			if (!payload || !signature || extra !== undefined) return undefined;
			const expected = Buffer.from(hmac({ purpose: "oauth-recovery", value: payload }));
			const actual = Buffer.from(signature);
			if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
			try {
				const parsed = RefreshAttempt.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
				return parsed.success ? parsed.data : undefined;
			} catch { return undefined; }
		},
	};
}
