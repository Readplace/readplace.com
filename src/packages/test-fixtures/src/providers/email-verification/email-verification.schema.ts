import { z } from "zod";
import type { VerificationToken } from "@packages/provider-contracts/email-verification";

export const VerificationTokenSchema = z.string().transform((s): VerificationToken => s as VerificationToken);
