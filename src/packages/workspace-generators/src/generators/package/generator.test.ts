import assert from "node:assert/strict";
import type { Tree } from "@nx/devkit";
import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import packageGenerator from "./generator";

const description = 'Says "hello" from the scaffolded package';

function readJson(tree: Tree, filePath: string) {
	const contents = tree.read(filePath, "utf-8");
	assert(contents, `${filePath} should exist`);
	return JSON.parse(contents);
}

describe("packageGenerator", () => {
	it("generates the standard package file set", () => {
		const tree = createTreeWithEmptyWorkspace();
		packageGenerator(tree, { name: "greeting-card", description });
		const expectedFiles = [
			"src/packages/greeting-card/.c8rc.json",
			"src/packages/greeting-card/biome.json",
			"src/packages/greeting-card/enforce-coverage.config.js",
			"src/packages/greeting-card/jest.config.js",
			"src/packages/greeting-card/knip.config.ts",
			"src/packages/greeting-card/package.json",
			"src/packages/greeting-card/project.json",
			"src/packages/greeting-card/tsconfig.json",
			"src/packages/greeting-card/tsconfig.lint.json",
			"src/packages/greeting-card/src/index.ts",
			"src/packages/greeting-card/src/greeting-card.ts",
			"src/packages/greeting-card/src/greeting-card.test.ts",
		];
		for (const file of expectedFiles) {
			assert(tree.exists(file), `${file} should be generated`);
		}
	});

	it("leaves no template tokens in generated paths", () => {
		const tree = createTreeWithEmptyWorkspace();
		packageGenerator(tree, { name: "greeting-card", description });
		const generatedPaths = tree
			.listChanges()
			.map((change) => change.path)
			.filter((changedPath) => changedPath.startsWith("src/packages/"));
		assert(generatedPaths.length > 0, "generator should create files");
		for (const generatedPath of generatedPaths) {
			assert(
				!generatedPath.includes("__"),
				`${generatedPath} should not contain template tokens`,
			);
		}
	});

	it("fills package.json with the scoped name and the description", () => {
		const tree = createTreeWithEmptyWorkspace();
		packageGenerator(tree, { name: "greeting-card", description });
		const packageJson = readJson(
			tree,
			"src/packages/greeting-card/package.json",
		);
		assert.equal(packageJson.name, "@packages/greeting-card");
		assert.equal(packageJson.description, description);
		assert.equal(
			packageJson.scripts.check,
			"nx run @packages/greeting-card:check",
		);
	});

	it("names the nx project after the scoped package", () => {
		const tree = createTreeWithEmptyWorkspace();
		packageGenerator(tree, { name: "greeting-card", description });
		const projectJson = readJson(
			tree,
			"src/packages/greeting-card/project.json",
		);
		assert.equal(projectJson.name, "@packages/greeting-card");
	});

	it("names the sample module after the package", () => {
		const tree = createTreeWithEmptyWorkspace();
		packageGenerator(tree, { name: "greeting-card", description });
		const module = tree.read("src/packages/greeting-card/src/greeting-card.ts", "utf-8");
		assert(module, "sample module should exist");
		assert.match(module, /export function greetingCard\(\): string/);
		assert.match(module, /@packages\/greeting-card/);
		const barrel = tree.read("src/packages/greeting-card/src/index.ts", "utf-8");
		assert(barrel, "barrel should exist");
		assert.match(barrel, /export { greetingCard } from ".\/greeting-card";/);
		const test = tree.read(
			"src/packages/greeting-card/src/greeting-card.test.ts",
			"utf-8",
		);
		assert(test, "sample test should exist");
		assert.match(test, /import { greetingCard } from ".\/greeting-card";/);
	});

	it("normalises a non-kebab name before scaffolding", () => {
		const tree = createTreeWithEmptyWorkspace();
		packageGenerator(tree, { name: "GreetingCard", description });
		assert(tree.exists("src/packages/greeting-card/package.json"));
	});

	it("rejects a name that cannot normalise to kebab-case", () => {
		const tree = createTreeWithEmptyWorkspace();
		assert.throws(
			() => packageGenerator(tree, { name: "1bad", description }),
			/kebab-case/,
		);
	});

	it("rejects a blank description", () => {
		const tree = createTreeWithEmptyWorkspace();
		assert.throws(
			() => packageGenerator(tree, { name: "greeting-card", description: "  " }),
			/non-empty description/,
		);
	});

	it("rejects scaffolding over an existing package", () => {
		const tree = createTreeWithEmptyWorkspace();
		packageGenerator(tree, { name: "greeting-card", description });
		assert.throws(
			() => packageGenerator(tree, { name: "greeting-card", description }),
			/already exists/,
		);
	});
});
