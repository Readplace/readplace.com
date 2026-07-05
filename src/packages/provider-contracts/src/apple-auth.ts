import { z } from "zod";

export const AppleIdSchema = z.string().brand<"AppleId">();

export type AppleId = z.infer<typeof AppleIdSchema>;

export interface AppleTokenResult {
	appleId: AppleId;
	email: string;
	emailVerified: boolean;
}

export type ExchangeAppleCode = (code: string) => Promise<AppleTokenResult>;
