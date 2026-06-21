import { z } from "zod";

export const VerificationTokenSchema = z.string().brand<"VerificationToken">();
