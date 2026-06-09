import { z } from "zod";
import { UserIdSchema, type UserId } from "@packages/domain/user";

export const RESURFACE_COOKIE_NAME = "resurface";

const MAX_COOKIE_IDS = 50;
const MAX_PROMPT_LENGTH = 500;

export interface ResurfaceResult {
	readonly userId: UserId;
	readonly prompt: string;
	readonly ids: readonly string[];
}

const ResurfaceResultSchema = z.object({
	userId: UserIdSchema,
	prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
	ids: z.array(z.string()),
});

export function encodeResurfaceCookie(result: ResurfaceResult): string {
	const payload: ResurfaceResult = {
		userId: result.userId,
		prompt: result.prompt.slice(0, MAX_PROMPT_LENGTH),
		ids: result.ids.slice(0, MAX_COOKIE_IDS),
	};
	return encodeURIComponent(JSON.stringify(payload));
}

export function decodeResurfaceCookie(raw: string | undefined): ResurfaceResult | undefined {
	if (!raw) return undefined;
	let decoded: unknown;
	try {
		decoded = JSON.parse(decodeURIComponent(raw));
	} catch {
		return undefined;
	}
	const parsed = ResurfaceResultSchema.safeParse(decoded);
	return parsed.success ? parsed.data : undefined;
}
