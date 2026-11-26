import assert from "node:assert/strict";
import { defaultUpdateVisualBaselinesDeps, initUpdateVisualBaselines, type UpdateVisualBaselinesDeps } from "./update-visual-baselines";

type RunCall = Parameters<UpdateVisualBaselinesDeps["run"]>[0];

function fakeDeps(overrides: Partial<UpdateVisualBaselinesDeps> = {}) {
	const runs: RunCall[] = [];
	const logged: string[] = [];
	const deps: UpdateVisualBaselinesDeps = {
		run: (call) => {
			runs.push(call);
		},
		capture: () => "",
		globSync: (pattern) => (pattern.includes("visual") ? ["src/e2e/b-visual.e2e-local.ts", "src/e2e/a-visual.e2e-local.ts"] : ["src/e2e/flow/run.e2e-local.ts"]),
		getFreePort: async () => 4321,
		rendersNatively: () => true,
		shouldInstallBrowsers: () => false,
		parentEnv: () => ({ PATH: "/bin" }),
		log: (message) => logged.push(message),
		...overrides,
	};
	return { deps, runs, logged };
}

const INPUT = {
	projectRoot: "/work/projects/demo",
	workspaceRoot: "/work",
	projectLabel: "Demo",
	specPatterns: ["src/e2e/**/*-visual.e2e-local.ts", "src/e2e/flow/run.e2e-local.ts"],
	playwrightVersion: "1.60.0",
	argvSpecs: [],
};

describe("initUpdateVisualBaselines", () => {
	it("regenerates only the specs named on the command line", async () => {
		const { deps, runs, logged } = fakeDeps();

		await initUpdateVisualBaselines(deps)({ ...INPUT, argvSpecs: ["src/e2e/only-visual.e2e-local.ts"] });

		assert.equal(runs.length, 1);
		assert.deepEqual(runs[0]?.args, [
			"-c",
			"node_modules/.bin/playwright test --config playwright.config.local-dev.ts --update-snapshots=all src/e2e/only-visual.e2e-local.ts",
		]);
		assert.equal(logged[0], "\n=== Demo - Regenerating visual baselines for src/e2e/only-visual.e2e-local.ts ===\n");
	});

	it("regenerates every spec the patterns match, sorted, with no spec named", async () => {
		const { deps, runs } = fakeDeps();

		await initUpdateVisualBaselines(deps)(INPUT);

		assert.match(
			runs[0]?.args[1] ?? "",
			/--update-snapshots=all src\/e2e\/a-visual\.e2e-local\.ts src\/e2e\/b-visual\.e2e-local\.ts src\/e2e\/flow\/run\.e2e-local\.ts$/,
		);
		assert.deepEqual(runs[0]?.env, { PATH: "/bin", HEADLESS: "true", E2E_PORT: "4321" });
		assert.equal(runs[0]?.cwd, "/work/projects/demo");
	});

	it("refuses a pattern that matches no spec", async () => {
		const { deps } = fakeDeps({ globSync: () => [] });

		await assert.rejects(initUpdateVisualBaselines(deps)(INPUT), /no visual specs matched src\/e2e\/\*\*\/\*-visual\.e2e-local\.ts/);
	});

	it("installs chromium first when the machine has no provided browsers", async () => {
		const { deps, runs } = fakeDeps({ shouldInstallBrowsers: () => true });

		await initUpdateVisualBaselines(deps)(INPUT);

		assert.deepEqual(
			runs.map((call) => [call.command, call.args[0]]),
			[
				["node_modules/.bin/playwright", "install"],
				["bash", "-c"],
			],
		);
	});

	it("pulls the pinned image and renders in a container off Linux", async () => {
		const { deps, runs } = fakeDeps({ rendersNatively: () => false });

		await initUpdateVisualBaselines(deps)(INPUT);

		assert.deepEqual(runs[0]?.args, ["pull", "mcr.microsoft.com/playwright:v1.60.0-noble"]);
		assert.match(runs[1]?.args[1] ?? "", /^docker run --rm --ipc=host --volume '\/work:\/work'/);
	});

	it("names Docker as the cause when the image cannot be pulled", async () => {
		const { deps } = fakeDeps({
			rendersNatively: () => false,
			run: () => {
				throw new Error("docker: not running");
			},
		});

		await assert.rejects(initUpdateVisualBaselines(deps)(INPUT), /Cannot reach Docker to pull mcr\.microsoft\.com\/playwright:v1\.60\.0-noble/);
	});

	it("lists the changed baselines from git", async () => {
		const asked: string[][] = [];
		const { deps, logged } = fakeDeps({
			capture: ({ args }) => {
				asked.push(args);
				return " M src/e2e/only-visual.e2e-local.ts-snapshots/a.png\n";
			},
		});

		await initUpdateVisualBaselines(deps)({ ...INPUT, argvSpecs: ["src/e2e/only-visual.e2e-local.ts"] });

		assert.deepEqual(asked, [["status", "--porcelain", "--", "src/e2e/only-visual.e2e-local.ts-snapshots"]]);
		assert.equal(logged[1], "\nBaselines changed — review the diff before committing:\nM src/e2e/only-visual.e2e-local.ts-snapshots/a.png\n");
	});

	it("says the baselines are unchanged when git reports nothing", async () => {
		const { deps, logged } = fakeDeps();

		await initUpdateVisualBaselines(deps)(INPUT);

		assert.equal(logged[1], "\nBaselines are byte-identical to the committed ones.\n");
	});
});

describe("defaultUpdateVisualBaselinesDeps", () => {
	it("runs and captures real commands in the given directory", () => {
		defaultUpdateVisualBaselinesDeps.run({ command: process.execPath, args: ["-e", ""], cwd: __dirname, env: defaultUpdateVisualBaselinesDeps.parentEnv() });

		assert.equal(
			defaultUpdateVisualBaselinesDeps.capture({ command: process.execPath, args: ["-e", "process.stdout.write(process.cwd())"], cwd: __dirname }),
			__dirname,
		);
	});

	it("globs relative to the given directory", () => {
		assert.deepEqual([...defaultUpdateVisualBaselinesDeps.globSync("update-visual-baselines.test.js", { cwd: __dirname })], ["update-visual-baselines.test.js"]);
	});
});
