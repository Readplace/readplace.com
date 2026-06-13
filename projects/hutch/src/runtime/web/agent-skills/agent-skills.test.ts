import { createHash } from "node:crypto";
import { initAgentSkills } from "./agent-skills";

const BASE_URL = "https://readplace.com";

describe("initAgentSkills", () => {
	it("publishes a discovery index with the RFC v0.2.0 schema", () => {
		const index = initAgentSkills().buildIndex({ baseUrl: BASE_URL });
		expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
		expect(index.skills.length).toBeGreaterThan(0);
	});

	it("describes each skill as a skill-md artifact at an absolute URL under the discovery namespace", () => {
		const index = initAgentSkills().buildIndex({ baseUrl: BASE_URL });
		for (const skill of index.skills) {
			expect(skill.type).toBe("skill-md");
			expect(typeof skill.name).toBe("string");
			expect(typeof skill.description).toBe("string");
			expect(skill.url).toBe(`${BASE_URL}/.well-known/agent-skills/${skill.name}/SKILL.md`);
			expect(skill.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
	});

	it("computes each digest as the sha256 of the raw SKILL.md bytes it serves", () => {
		const agentSkills = initAgentSkills();
		const index = agentSkills.buildIndex({ baseUrl: BASE_URL });
		for (const skill of agentSkills.getAll()) {
			const expected = `sha256:${createHash("sha256").update(skill.content).digest("hex")}`;
			expect(skill.digest).toBe(expected);
			const entry = index.skills.find((s) => s.name === skill.name);
			expect(entry?.digest).toBe(expected);
		}
	});

	it("publishes the save-to-readplace skill", () => {
		const index = initAgentSkills().buildIndex({ baseUrl: BASE_URL });
		const skill = index.skills.find((s) => s.name === "save-to-readplace");
		expect(skill?.description).toContain("Readplace");
	});
});
