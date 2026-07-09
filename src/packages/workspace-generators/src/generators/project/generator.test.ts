import assert from "node:assert/strict";
import type { Tree } from "@nx/devkit";
import { createTreeWithEmptyWorkspace } from "@nx/devkit/testing";
import projectGenerator from "./generator";

const description = 'Serves "hello" from the scaffolded project';

function readJson(tree: Tree, filePath: string) {
	const contents = tree.read(filePath, "utf-8");
	assert(contents, `${filePath} should exist`);
	return JSON.parse(contents);
}

describe("projectGenerator", () => {
	it("generates the standard project file set", () => {
		const tree = createTreeWithEmptyWorkspace();
		projectGenerator(tree, { name: "hello-service", description });
		const expectedFiles = [
			"projects/hello-service/.c8rc.json",
			"projects/hello-service/biome.json",
			"projects/hello-service/enforce-coverage.config.js",
			"projects/hello-service/jest.config.js",
			"projects/hello-service/knip.config.ts",
			"projects/hello-service/package.json",
			"projects/hello-service/project.json",
			"projects/hello-service/tsconfig.json",
			"projects/hello-service/tsconfig.lint.json",
			"projects/hello-service/src/runtime/hello-service.ts",
			"projects/hello-service/src/runtime/hello-service.test.ts",
		];
		for (const file of expectedFiles) {
			assert(tree.exists(file), `${file} should be generated`);
		}
	});

	it("leaves no template tokens in generated paths", () => {
		const tree = createTreeWithEmptyWorkspace();
		projectGenerator(tree, { name: "hello-service", description });
		const generatedPaths = tree
			.listChanges()
			.map((change) => change.path)
			.filter((changedPath) => changedPath.startsWith("projects/"));
		assert(generatedPaths.length > 0, "generator should create files");
		for (const generatedPath of generatedPaths) {
			assert(
				!generatedPath.includes("__"),
				`${generatedPath} should not contain template tokens`,
			);
		}
	});

	it("fills package.json with the unscoped name and the description", () => {
		const tree = createTreeWithEmptyWorkspace();
		projectGenerator(tree, { name: "hello-service", description });
		const packageJson = readJson(tree, "projects/hello-service/package.json");
		assert.equal(packageJson.name, "hello-service");
		assert.equal(packageJson.description, description);
		assert.equal(
			packageJson.scripts.check,
			"nx run hello-service:check",
		);
		assert.equal(packageJson.main, "src/runtime/hello-service.ts");
	});

	it("wires the check target through lint and coverage", () => {
		const tree = createTreeWithEmptyWorkspace();
		projectGenerator(tree, { name: "hello-service", description });
		const projectJson = readJson(tree, "projects/hello-service/project.json");
		assert.equal(projectJson.name, "hello-service");
		const targets = projectJson.targets;
		assert.deepEqual(targets.check.dependsOn, ["lint", "test-with-coverage"]);
		assert.deepEqual(targets.lint.dependsOn, ["compile"]);
		assert.deepEqual(targets["test-with-coverage"].dependsOn, ["compile"]);
	});

	it("self-heals missing node_modules before compiling", () => {
		const tree = createTreeWithEmptyWorkspace();
		projectGenerator(tree, { name: "hello-service", description });
		const projectJson = readJson(tree, "projects/hello-service/project.json");
		const targets = projectJson.targets;
		assert.equal(
			targets["install-deps"].command,
			"test -d projects/hello-service/node_modules || pnpm install --frozen-lockfile",
		);
		assert.equal(targets["install-deps"].cache, false);
		assert.deepEqual(targets.compile.dependsOn, ["install-deps", "^compile"]);
		assert.deepEqual(targets.test, {});
	});

	it("names the sample runtime module after the project", () => {
		const tree = createTreeWithEmptyWorkspace();
		projectGenerator(tree, { name: "hello-service", description });
		const module = tree.read(
			"projects/hello-service/src/runtime/hello-service.ts",
			"utf-8",
		);
		assert(module, "sample module should exist");
		assert.match(module, /export function helloService\(\): string/);
		const test = tree.read(
			"projects/hello-service/src/runtime/hello-service.test.ts",
			"utf-8",
		);
		assert(test, "sample test should exist");
		assert.match(test, /import { helloService } from ".\/hello-service";/);
	});

	it("normalises a non-kebab name before scaffolding", () => {
		const tree = createTreeWithEmptyWorkspace();
		projectGenerator(tree, { name: "HelloService", description });
		assert(tree.exists("projects/hello-service/package.json"));
	});

	it("rejects a name that cannot normalise to kebab-case", () => {
		const tree = createTreeWithEmptyWorkspace();
		assert.throws(
			() => projectGenerator(tree, { name: "1bad", description }),
			/kebab-case/,
		);
	});

	it("rejects a blank description", () => {
		const tree = createTreeWithEmptyWorkspace();
		assert.throws(
			() => projectGenerator(tree, { name: "hello-service", description: "  " }),
			/non-empty description/,
		);
	});

	it("rejects scaffolding over an existing project", () => {
		const tree = createTreeWithEmptyWorkspace();
		projectGenerator(tree, { name: "hello-service", description });
		assert.throws(
			() => projectGenerator(tree, { name: "hello-service", description }),
			/already exists/,
		);
	});
});
