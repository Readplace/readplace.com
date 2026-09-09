import { z } from "zod";

export const GmailAccountEmailSchema = z.string().brand<"GmailAccountEmail">();

export type GmailAccountEmail = z.infer<typeof GmailAccountEmailSchema>;
