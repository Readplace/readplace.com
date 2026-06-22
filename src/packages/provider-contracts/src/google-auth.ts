import { z } from "zod";

export const GoogleIdSchema = z.string().brand<"GoogleId">();

export type GoogleId = z.infer<typeof GoogleIdSchema>;

export interface GoogleTokenResult {
	googleId: GoogleId;
	email: string;
	emailVerified: boolean;
}

export type ExchangeGoogleCode = (code: string) => Promise<GoogleTokenResult>;
