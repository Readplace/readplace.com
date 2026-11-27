import type { z } from "zod";
import type { CreateAiMessage } from "./create-ai-message.types";

export type ModelJsonAnswer<T> =
	| { kind: "parsed"; value: T }
	| { kind: "no-text" }
	| { kind: "malformed"; error: Error };

export function parseModelJson<S extends z.ZodTypeAny>(
	schema: S,
	response: Awaited<ReturnType<CreateAiMessage>>,
): ModelJsonAnswer<z.infer<S>> {
	const text = response.content.find((block) => block.type === "text" && block.text)?.text;
	if (!text) return { kind: "no-text" };
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return { kind: "malformed", error: new SyntaxError("Model response contains invalid JSON") };
	}
	const result = schema.safeParse(json);
	if (!result.success) return { kind: "malformed", error: new Error("Model response does not match the requested schema") };
	return { kind: "parsed", value: result.data };
}
