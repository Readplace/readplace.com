import assert from "node:assert/strict";
import type { CreateAiMessage } from "@packages/ai-message";
import { EmailLinkOrdinalSchema } from "@packages/domain/inbox";
import { noopLogger } from "@packages/hutch-logger";
import { initDecideEmailLinks } from "./decide-email-links";

const ordinal = (value: string) => EmailLinkOrdinalSchema.parse(value);

const INPUT = {
	purpose: "Engineering practice: code review, testing, and shipping small changes.",
	subject: "This week in software",
	senderEmail: "news@example.com",
	links: [
		{ ordinal: ordinal("0000"), url: "https://a.test/small-prs", anchorText: "Ship small PRs" },
		{ ordinal: ordinal("0002"), url: "https://b.test/sale", anchorText: "Our spring sale" },
		{ ordinal: ordinal("0005"), url: "https://c.test/testing", anchorText: "Testing in production" },
	],
};

type Captured = Parameters<CreateAiMessage>[0];

function answering(
	body: unknown,
	usage: Awaited<ReturnType<CreateAiMessage>>["usage"] = {
		input_tokens: 900,
		output_tokens: 4000,
		reasoning_tokens: 3500,
	},
): { createMessage: CreateAiMessage; calls: Captured[] } {
	const calls: Captured[] = [];
	const createMessage: CreateAiMessage = async (params) => {
		calls.push(params);
		return { content: [{ type: "text", text: JSON.stringify(body) }], usage };
	};
	return { createMessage, calls };
}

const labelsFor = (verdicts: Record<string, "keep" | "drop">) => ({
	links: Object.entries(verdicts).map(([key, verdict]) => ({
		ordinal: key,
		verdict,
		reason: `${verdict} because of ${key}`,
	})),
});

describe("initDecideEmailLinks", () => {
	it("keeps the links the model keeps and drops the rest, each drop carrying its reason, in ordinal order", async () => {
		const { createMessage } = answering({
			links: [
				{ ordinal: "0005", verdict: "keep", reason: "Testing practice." },
				{ ordinal: "0002", verdict: "drop", reason: "A product sale, not engineering practice." },
				{ ordinal: "0000", verdict: "keep", reason: "Code review practice." },
			],
		});
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		const decided = await decideEmailLinks(INPUT);

		assert.deepEqual(decided, {
			kept: ["0000", "0005"],
			dropped: [{ ordinal: "0002", reason: "A product sale, not engineering practice." }],
			inputTokens: 900,
			outputTokens: 4000,
			reasoningTokens: 3500,
		});
	});

	it("sends the purpose and the links as data in the user message, never inside the instructions", async () => {
		const { createMessage, calls } = answering(labelsFor({ "0000": "keep", "0002": "keep", "0005": "keep" }));
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		await decideEmailLinks({
			...INPUT,
			links: [{ ...INPUT.links[0], url: `https://a.test/${"x".repeat(400)}` }, INPUT.links[1], INPUT.links[2]],
		});

		const [call] = calls;
		assert(call);
		expect(call.system).not.toContain(INPUT.purpose);
		expect(call.max_tokens).toBe(32_768);
		expect(call.messages).toHaveLength(1);
		const content = call.messages[0]?.content;
		assert(typeof content === "string");
		const sent = JSON.parse(content);
		expect(sent.purpose).toBe(INPUT.purpose);
		expect(sent.subject).toBe("This week in software");
		expect(sent.from).toBe("news@example.com");
		expect(sent.links[0].url).toHaveLength(300);
		expect(sent.links.map((link: { ordinal: string }) => link.ordinal)).toEqual(["0000", "0002", "0005"]);
		expect(sent.links[1].anchorText).toBe("Our spring sale");
	});

	it("shows the model the answer's field names and an example, with the reason length filled in", async () => {
		const { createMessage, calls } = answering(labelsFor({ "0000": "keep", "0002": "keep", "0005": "keep" }));
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		await decideEmailLinks(INPUT);

		const system = calls[0]?.system;
		expect(system).toContain('{"links": [{"ordinal": "0007", "verdict": "keep", "reason":');
		expect(system).toContain("at most 120 characters");
		expect(system).not.toContain("{{");
		expect(system).toContain("json");
	});

	it("accepts dropping every link, which is correct for a dense newsletter with nothing on topic", async () => {
		const { createMessage } = answering(labelsFor({ "0000": "drop", "0002": "drop", "0005": "drop" }));
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		const decided = await decideEmailLinks(INPUT);

		expect(decided.kept).toEqual([]);
		expect(decided.dropped.map((drop) => drop.ordinal)).toEqual(["0000", "0002", "0005"]);
	});

	it("clips a long reason and collapses its whitespace", async () => {
		const { createMessage } = answering({
			links: [
				{ ordinal: "0000", verdict: "keep", reason: "" },
				{ ordinal: "0002", verdict: "drop", reason: `  A sale.\n\n${"word ".repeat(60)}` },
				{ ordinal: "0005", verdict: "keep", reason: "" },
			],
		});
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		const decided = await decideEmailLinks(INPUT);

		const reason = decided.dropped[0]?.reason;
		expect(reason).toHaveLength(120);
		expect(reason?.startsWith("A sale. word word")).toBe(true);
	});

	it("reports no reasoning tokens when the model reports none", async () => {
		const { createMessage } = answering(labelsFor({ "0000": "keep", "0002": "keep", "0005": "keep" }), {
			input_tokens: 10,
			output_tokens: 20,
		});
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		const decided = await decideEmailLinks(INPUT);

		expect(decided.reasoningTokens).toBe(0);
	});

	it("throws when the model labels a link that is not in the email, so the queue retries the decision", async () => {
		const { createMessage } = answering(
			labelsFor({ "0000": "keep", "0002": "keep", "0005": "keep", "0009": "drop" }),
		);
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		await expect(decideEmailLinks(INPUT)).rejects.toThrow("0009");
	});

	it("throws when the model labels a link twice", async () => {
		const { createMessage } = answering({
			links: [
				{ ordinal: "0000", verdict: "keep", reason: "" },
				{ ordinal: "0000", verdict: "drop", reason: "" },
				{ ordinal: "0002", verdict: "keep", reason: "" },
				{ ordinal: "0005", verdict: "keep", reason: "" },
			],
		});
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		await expect(decideEmailLinks(INPUT)).rejects.toThrow("more than once");
	});

	it("throws when the model leaves a link unlabelled", async () => {
		const { createMessage } = answering(labelsFor({ "0000": "keep", "0005": "keep" }));
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		await expect(decideEmailLinks(INPUT)).rejects.toThrow("0002");
	});

	it("throws when the model labels something that is not an ordinal", async () => {
		const { createMessage } = answering(labelsFor({ "7": "keep", "0000": "keep", "0002": "keep", "0005": "keep" }));
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		await expect(decideEmailLinks(INPUT)).rejects.toThrow();
	});

	it("throws when the answer is not the labelled shape", async () => {
		const { createMessage } = answering({ kept: ["0000"] });
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		await expect(decideEmailLinks(INPUT)).rejects.toThrow();
	});

	it("throws when the response carries no text", async () => {
		const createMessage: CreateAiMessage = async () => ({
			content: [{ type: "thinking" }],
			usage: { input_tokens: 1, output_tokens: 1 },
		});
		const { decideEmailLinks } = initDecideEmailLinks({ createMessage, logger: noopLogger });

		await expect(decideEmailLinks(INPUT)).rejects.toThrow("no text block");
	});
});
