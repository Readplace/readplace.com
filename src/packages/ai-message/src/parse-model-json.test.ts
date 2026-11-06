import assert from "node:assert/strict";
import { z, ZodError } from "zod";
import { parseModelJson } from "./parse-model-json";

const AnswerSchema = z.object({ verdict: z.string() });

function response(content: Array<{ type: string; text?: string }>) {
	return { content, usage: { input_tokens: 1, output_tokens: 1 } };
}

describe("parseModelJson", () => {
	it("parses the text block against the schema", () => {
		const answer = parseModelJson(AnswerSchema, response([{ type: "text", text: '{"verdict":"keep"}' }]));

		assert.deepEqual(answer, { kind: "parsed", value: { verdict: "keep" }, text: '{"verdict":"keep"}' });
	});

	it("reports no text when the response has no text block", () => {
		const answer = parseModelJson(AnswerSchema, response([{ type: "thinking" }]));

		assert.deepEqual(answer, { kind: "no-text" });
	});

	it("reports no text when the text block is empty", () => {
		const answer = parseModelJson(AnswerSchema, response([{ type: "text", text: "" }]));

		assert.deepEqual(answer, { kind: "no-text" });
	});

	it("reads the first text block past a non-text block", () => {
		const answer = parseModelJson(
			AnswerSchema,
			response([{ type: "thinking", text: "pondering" }, { type: "text", text: '{"verdict":"drop"}' }]),
		);

		assert.deepEqual(answer, { kind: "parsed", value: { verdict: "drop" }, text: '{"verdict":"drop"}' });
	});

	it("reports text that is not JSON as malformed with the parse error", () => {
		const answer = parseModelJson(AnswerSchema, response([{ type: "text", text: "not json" }]));

		assert.equal(answer.kind, "malformed");
		assert(answer.kind === "malformed");
		assert.equal(answer.text, "not json");
		assert(answer.error instanceof SyntaxError);
	});

	it("reports JSON the schema refuses as malformed with the schema error", () => {
		const answer = parseModelJson(AnswerSchema, response([{ type: "text", text: '{"verdict":1}' }]));

		assert(answer.kind === "malformed");
		assert.equal(answer.text, '{"verdict":1}');
		assert(answer.error instanceof ZodError);
	});
});
