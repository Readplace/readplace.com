import { z } from "zod";
import type { UserId } from "@packages/domain/user";

export const VerificationTokenSchema = z.string().brand<"VerificationToken">();
export type VerificationToken = z.infer<typeof VerificationTokenSchema>;

export type CreateVerificationToken = (args: { userId: UserId; email: string }) => Promise<VerificationToken>;

export type VerifyEmailToken = (token: VerificationToken) => Promise<
	| { ok: true; userId: UserId; email: string }
	| { ok: false; reason: "invalid-token" }
>;
