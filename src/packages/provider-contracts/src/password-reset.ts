import { z } from "zod";
import type { $brand } from "zod";

export type PasswordResetToken = string & $brand<"PasswordResetToken">;

export const PasswordResetTokenSchema = z.string().brand<"PasswordResetToken">();

export type CreatePasswordResetToken = (args: { email: string }) => Promise<PasswordResetToken>;

export type VerifyPasswordResetToken = (token: PasswordResetToken) => Promise<
	| { ok: true; email: string }
	| { ok: false; reason: "invalid-token" }
>;
