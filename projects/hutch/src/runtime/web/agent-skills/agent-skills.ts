import assert from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { z } from "zod";

const DISCOVERY_SCHEMA_URI =
	"https://schemas.agentskills.io/discovery/0.2.0/schema.json";

const SkillFrontmatter = z.object({
	name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
	description: z.string(),
});

interface AgentSkill {
	readonly name: string;
	readonly description: string;
	readonly content: Buffer;
	readonly digest: string;
}

interface SkillIndexEntry {
	name: string;
	type: "skill-md";
	description: string;
	url: string;
	digest: string;
}

interface SkillsDiscoveryIndex {
	$schema: string;
	skills: SkillIndexEntry[];
}

interface AgentSkills {
	getAll: () => readonly AgentSkill[];
	buildIndex: () => SkillsDiscoveryIndex;
}

export function initAgentSkills(): AgentSkills {
	const skillsDir = join(__dirname, "skills");
	const dirNames = readdirSync(skillsDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);

	const skills: readonly AgentSkill[] = dirNames.map((dirName) => {
		const content = readFileSync(join(skillsDir, dirName, "SKILL.md"));
		const frontmatter = SkillFrontmatter.parse(matter(content).data);
		assert(
			frontmatter.name === dirName,
			`Skill name "${frontmatter.name}" does not match directory "${dirName}"`,
		);
		const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
		return Object.freeze({
			name: frontmatter.name,
			description: frontmatter.description,
			content,
			digest,
		});
	});

	assert(skills.length > 0, "No agent skills found to publish");
	const names = new Set(skills.map((skill) => skill.name));
	assert(names.size === skills.length, "Duplicate agent skill names detected");
	Object.freeze(skills);

	return {
		getAll: () => skills,
		buildIndex: () => ({
			$schema: DISCOVERY_SCHEMA_URI,
			skills: skills.map(
				(skill): SkillIndexEntry => ({
					name: skill.name,
					type: "skill-md",
					description: skill.description,
					url: `/.well-known/agent-skills/${skill.name}/SKILL.md`,
					digest: skill.digest,
				}),
			),
		}),
	};
}
