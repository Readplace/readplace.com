import "../zod-config";
import { z } from "zod";

export const OAuthTokensSchema = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
});

export type OAuthTokens = z.infer<typeof OAuthTokensSchema>;
