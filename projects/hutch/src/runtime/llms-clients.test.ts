import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADVERTISED_CLIENTS, UNADVERTISED_CLIENTS } from "@packages/supported-clients";

const LLMS_TXT = readFileSync(join(__dirname, "llms.txt"), "utf-8");
const LLMS_FULL_TXT = readFileSync(join(__dirname, "llms-full.txt"), "utf-8");
const AGENT_SKILL = readFileSync(
	join(__dirname, "web/agent-skills/skills/save-to-readplace/SKILL.md"),
	"utf-8",
);

/** The manifests are catalogues of what Readplace offers, so they owe a mention
 * of every client. The published skill documents the assistant's own path, so it
 * is held only to the honesty rule below. */
const CATALOGUE_DOCS = [
	{ name: "llms.txt", text: LLMS_TXT },
	{ name: "llms-full.txt", text: LLMS_FULL_TXT },
];

const DOCS_NAMING_WHAT_IS_MISSING = [
	...CATALOGUE_DOCS,
	{ name: "the published agent skill", text: AGENT_SKILL },
];

function docNamed(docs: { name: string; text: string }[], name: string): string {
	const doc = docs.find((candidate) => candidate.name === name);
	assert(doc, `no document named ${name}`);
	return doc.text;
}

describe("llms AI-discovery docs", () => {
	it.each(CATALOGUE_DOCS.map((doc) => doc.name))(
		"%s mentions every advertised client by display name",
		(name) => {
			const text = docNamed(CATALOGUE_DOCS, name);
			for (const client of ADVERTISED_CLIENTS) {
				assert.equal(
					text.includes(client.displayName),
					true,
					`${name} must mention ${client.displayName}`,
				);
			}
		},
	);

	it.each(DOCS_NAMING_WHAT_IS_MISSING.map((doc) => doc.name))(
		"%s states the app gap for every unadvertised client, and never for an advertised one",
		(name) => {
			const text = docNamed(DOCS_NAMING_WHAT_IS_MISSING, name);
			for (const client of UNADVERTISED_CLIENTS) {
				assert.equal(
					text.includes(`no ${client.displayName} app`),
					true,
					`${name} must say there is no ${client.displayName} app`,
				);
			}
			for (const client of ADVERTISED_CLIENTS) {
				assert.equal(
					text.includes(`no ${client.displayName} app`),
					false,
					`${name} still denies the now-advertised ${client.displayName} app`,
				);
			}
		},
	);
});
