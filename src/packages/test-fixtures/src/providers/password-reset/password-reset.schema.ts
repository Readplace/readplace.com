import { z } from "zod";
import type { PasswordResetToken } from "@packages/provider-contracts/password-reset";

export const PasswordResetTokenSchema = z.string().transform((s): PasswordResetToken => s as PasswordResetToken);
