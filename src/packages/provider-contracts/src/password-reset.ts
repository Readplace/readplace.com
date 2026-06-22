import { z } from "zod";

export const PasswordResetTokenSchema = z.string().brand<"PasswordResetToken">();

export type PasswordResetToken = z.infer<typeof PasswordResetTokenSchema>;

export type CreatePasswordResetToken = (args: { email: string }) => Promise<PasswordResetToken>;

export type VerifyPasswordResetToken = (token: PasswordResetToken) => Promise<
	| { ok: true; email: string }
	| { ok: false; reason: "invalid-token" }
>;
