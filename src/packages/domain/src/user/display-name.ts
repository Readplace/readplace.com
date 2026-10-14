import { z } from "zod";

export const DISPLAY_NAME_MAX_LENGTH = 64;

export const DisplayNameSchema = z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH).brand<"DisplayName">();

export type DisplayName = z.infer<typeof DisplayNameSchema>;

type DisplayNameInput =
	| { ok: true; displayName: DisplayName | undefined }
	| { ok: false; reason: "too-long" };

export function parseDisplayNameInput(raw: string): DisplayNameInput {
	if (raw.trim() === "") return { ok: true, displayName: undefined };
	const parsed = DisplayNameSchema.safeParse(raw);
	return parsed.success ? { ok: true, displayName: parsed.data } : { ok: false, reason: "too-long" };
}
