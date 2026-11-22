import assert from "node:assert/strict";
import type { GetParameterCommand } from "@aws-sdk/client-ssm";
import { parseExcludedIdentities } from "@packages/dashboard-widgets";
import { initSsmExcludedIdentities } from "./ssm-excluded-identities";

describe("initSsmExcludedIdentities", () => {
	it("reads the named parameter and returns what the injected parser made of its value", async () => {
		const requested: GetParameterCommand[] = [];
		const readExcludedIdentities = initSsmExcludedIdentities({
			getParameter: async (command) => {
				requested.push(command);
				return { Parameter: { Value: "{\"raw\":true}" } };
			},
			parameterName: "/readplace/excluded-identities",
			parseExcludedIdentities: (json) => {
				assert.equal(json, "{\"raw\":true}");
				return { excludedVisitorIds: ["293b32c4-898e-485d-8a92-3f2f32f53289"], excludedUserIds: [] };
			},
		});

		assert.deepEqual(await readExcludedIdentities(), {
			excludedVisitorIds: ["293b32c4-898e-485d-8a92-3f2f32f53289"],
			excludedUserIds: [],
		});
		assert.deepEqual(requested.map((command) => command.input), [{ Name: "/readplace/excluded-identities" }]);
	});

	it("fails the request when the parameter holds no value", async () => {
		const readExcludedIdentities = initSsmExcludedIdentities({
			getParameter: async () => ({ Parameter: {} }),
			parameterName: "/readplace/excluded-identities",
			parseExcludedIdentities,
		});

		await assert.rejects(readExcludedIdentities(), /SSM parameter \/readplace\/excluded-identities must hold a value/);
	});

	it("reads the parameter once and answers later calls from the value it holds", async () => {
		const requested: GetParameterCommand[] = [];
		let parses = 0;
		const parsed = { excludedVisitorIds: ["293b32c4-898e-485d-8a92-3f2f32f53289"], excludedUserIds: [] };
		const readExcludedIdentities = initSsmExcludedIdentities({
			getParameter: async (command) => {
				requested.push(command);
				return { Parameter: { Value: "{\"raw\":true}" } };
			},
			parameterName: "/readplace/excluded-identities",
			parseExcludedIdentities: () => {
				parses += 1;
				return parsed;
			},
		});

		const results = [await readExcludedIdentities(), await readExcludedIdentities(), await readExcludedIdentities()];

		assert.deepEqual(results, [parsed, parsed, parsed]);
		assert.equal(requested.length, 1);
		assert.equal(parses, 1);
	});

	it("does not hold a failed read: the next call reads the parameter again", async () => {
		const requested: GetParameterCommand[] = [];
		const answers: Array<() => Promise<{ Parameter?: { Value?: string } }>> = [
			async () => {
				throw new Error("Rate exceeded");
			},
			async () => ({ Parameter: { Value: JSON.stringify({ excludedVisitorIds: [], excludedUserIds: ["f19792f1a14cf1d500de060278ab4bc3"] }) } }),
		];
		const readExcludedIdentities = initSsmExcludedIdentities({
			getParameter: (command) => {
				requested.push(command);
				const answer = answers.shift();
				assert(answer, "no more parameter answers");
				return answer();
			},
			parameterName: "/readplace/excluded-identities",
			parseExcludedIdentities,
		});

		await assert.rejects(readExcludedIdentities(), /Rate exceeded/);
		const expected = { excludedVisitorIds: [], excludedUserIds: ["f19792f1a14cf1d500de060278ab4bc3"] };
		assert.deepEqual(await readExcludedIdentities(), expected);
		assert.deepEqual(await readExcludedIdentities(), expected);
		assert.equal(requested.length, 2);
	});

	it("does not hold a value the parser refused", async () => {
		const requested: GetParameterCommand[] = [];
		const parsed = { excludedVisitorIds: ["293b32c4-898e-485d-8a92-3f2f32f53289"], excludedUserIds: [] };
		const parses: Array<() => typeof parsed> = [
			() => {
				throw new Error("excluded identities must be JSON");
			},
			() => parsed,
		];
		const readExcludedIdentities = initSsmExcludedIdentities({
			getParameter: async (command) => {
				requested.push(command);
				return { Parameter: { Value: "{\"raw\":true}" } };
			},
			parameterName: "/readplace/excluded-identities",
			parseExcludedIdentities: () => {
				const parse = parses.shift();
				assert(parse, "no more parser answers");
				return parse();
			},
		});

		await assert.rejects(readExcludedIdentities(), /excluded identities must be JSON/);
		assert.deepEqual(await readExcludedIdentities(), parsed);
		assert.equal(requested.length, 2);
	});
});
