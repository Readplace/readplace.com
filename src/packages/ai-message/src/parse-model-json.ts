import type { z } from "zod";
import type { CreateAiMessage } from "./create-ai-message.types";

export type ModelJsonAnswer<T> =
	| { kind: "parsed"; value: T; text: string }
	| { kind: "no-text" }
	| { kind: "malformed"; text: string; error: unknown };

export function parseModelJson<S extends z.ZodTypeAny>(
	schema: S,
	response: Awaited<ReturnType<CreateAiMessage>>,
): ModelJsonAnswer<z.infer<S>> {
	const text = response.content.find((block) => block.type === "text" && block.text)?.text;
	if (!text) return { kind: "no-text" };
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (error) {
		return { kind: "malformed", text, error };
	}
	const result = schema.safeParse(json);
	if (!result.success) return { kind: "malformed", text, error: result.error };
	return { kind: "parsed", value: result.data, text };
}
