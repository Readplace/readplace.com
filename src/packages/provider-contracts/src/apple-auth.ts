import { z } from "zod";

export const AppleIdSchema = z.string().brand<"AppleId">();

export type AppleId = z.infer<typeof AppleIdSchema>;

export interface AppleTokenResult {
	appleId: AppleId;
	email: string;
	emailVerified: boolean;
	/** Apple's refresh_token from the code exchange. Persisted so account
	 * deletion can revoke the Sign in with Apple grant (App Store 5.1.1(v)). */
	appleRefreshToken: string;
}

export type ExchangeAppleCode = (code: string) => Promise<AppleTokenResult>;
