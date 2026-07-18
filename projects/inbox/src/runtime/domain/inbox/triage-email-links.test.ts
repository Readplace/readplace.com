import assert from "node:assert/strict";
import type { CreateAiMessage } from "@packages/ai-message";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import { EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import { initTriageEmailLinks } from "./triage-email-links";

const logger = HutchLogger.from(noopLogger);

function respondingWith(text: string): CreateAiMessage {
	return async () => ({
		content: [{ type: "text", text }],
		usage: { input_tokens: 1, output_tokens: 1 },
	});
}

function linkInput(overrides: { url?: string; anchorText?: string } = {}) {
	return {
		subject: "Digest",
		from: "news@example.com",
		links: [
			{
				ordinal: EmailLinkOrdinalSchema.parse("0000"),
				url: overrides.url ?? "https://a.test/x",
				anchorText: overrides.anchorText ?? "Read",
			},
		],
	};
}

describe("initTriageEmailLinks", () => {
	it("maps verdicts back to known ordinals and drops unknown or malformed ones", async () => {
		const { triageEmailLinks } = initTriageEmailLinks({
			createAiMessage: respondingWith(
				JSON.stringify({
					links: [
						{ ordinal: "0000", category: "noise" },
						{ ordinal: "9999", category: "ad" },
						{ ordinal: "not-an-ordinal", category: "menu" },
					],
				}),
			),
			logger,
		});

		const result = await triageEmailLinks(linkInput());

		assert(result.status === "triaged");
		expect([...result.categories.entries()]).toEqual([["0000", "noise"]]);
	});

	it("truncates long URLs and forwards the email context in the model input", async () => {
		let captured: { system: string; messages: { content: unknown }[] } | undefined;
		const { triageEmailLinks } = initTriageEmailLinks({
			createAiMessage: async (params) => {
				captured = params;
				return {
					content: [{ type: "text", text: JSON.stringify({ links: [] }) }],
					usage: { input_tokens: 1, output_tokens: 1 },
				};
			},
			logger,
		});

		await triageEmailLinks(linkInput({ url: `https://a.test/${"p".repeat(400)}` }));

		assert(captured);
		expect(captured.system).toContain("You classify hyperlinks");
		const content = captured.messages[0].content;
		assert(typeof content === "string");
		const payload = JSON.parse(content);
		expect(payload.subject).toBe("Digest");
		expect(payload.from).toBe("news@example.com");
		expect(payload.links[0].anchorText).toBe("Read");
		expect(payload.links[0].url).toHaveLength(300);
	});

	it("returns unavailable when the response carries no text block", async () => {
		const { triageEmailLinks } = initTriageEmailLinks({
			createAiMessage: async () => ({
				content: [{ type: "thinking" }],
				usage: { input_tokens: 1, output_tokens: 1 },
			}),
			logger,
		});

		expect(await triageEmailLinks(linkInput())).toEqual({ status: "unavailable" });
	});

	it("returns unavailable for a response that is not JSON", async () => {
		const { triageEmailLinks } = initTriageEmailLinks({
			createAiMessage: respondingWith("not json"),
			logger,
		});

		expect(await triageEmailLinks(linkInput())).toEqual({ status: "unavailable" });
	});

	it("returns unavailable for valid JSON whose shape fails validation", async () => {
		const { triageEmailLinks } = initTriageEmailLinks({
			createAiMessage: respondingWith(JSON.stringify({ links: "not-an-array" })),
			logger,
		});

		expect(await triageEmailLinks(linkInput())).toEqual({ status: "unavailable" });
	});

	it("recovers on the second attempt after a transient failure", async () => {
		let calls = 0;
		const { triageEmailLinks } = initTriageEmailLinks({
			createAiMessage: async () => {
				calls += 1;
				if (calls === 1) throw new Error("transient blip");
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({ links: [{ ordinal: "0000", category: "ad" }] }),
						},
					],
					usage: { input_tokens: 1, output_tokens: 1 },
				};
			},
			logger,
		});

		const result = await triageEmailLinks(linkInput());

		assert(result.status === "triaged");
		expect([...result.categories.entries()]).toEqual([["0000", "ad"]]);
		expect(calls).toBe(2);
	});

	it("returns unavailable once both attempts fail", async () => {
		let calls = 0;
		const { triageEmailLinks } = initTriageEmailLinks({
			createAiMessage: async () => {
				calls += 1;
				throw new Error("deepseek down");
			},
			logger,
		});

		expect(await triageEmailLinks(linkInput())).toEqual({ status: "unavailable" });
		expect(calls).toBe(2);
	});
});
