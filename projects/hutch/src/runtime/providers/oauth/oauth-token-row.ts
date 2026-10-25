import { OAuthSignInSchema } from "@packages/domain/oauth";
import { z } from "zod";
import { CredentialFingerprint, OAuthGrantId } from "../../oauth-refresh/evidence";

export const OAuthTokenRow = z.object({
	pk: z.string(),
	accessToken: z.string(),
	refreshToken: z.string(),
	accessTokenExpiresAt: z.number(),
	refreshTokenExpiresAt: z.number(),
	clientId: z.string(),
	userId: z.string(),
	scope: z.array(z.string()).optional(),
	emailVerified: z.boolean().optional(),
	grantId: OAuthGrantId.optional(),
	parentFingerprint: CredentialFingerprint.optional(),
	epoch: z.number().optional(),
	generation: z.number().optional(),
	keyThumbprint: z.string().optional(),
	signedIn: OAuthSignInSchema.optional(),
});
export type OAuthTokenRow = z.infer<typeof OAuthTokenRow>;
