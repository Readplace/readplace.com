import { containerisedCommand, playwrightImage } from "./playwright-renderer";

const RENDERER = {
	image: "mcr.microsoft.com/playwright:v1.60.0-noble",
	workspaceRoot: "/work",
	forwardEnv: ["HEADLESS", "E2E_PORT"],
};

describe("playwrightImage", () => {
	it("names the image after the exact version the workspace pins", () => {
		expect(playwrightImage("1.60.0")).toBe("mcr.microsoft.com/playwright:v1.60.0-noble");
	});

	it.each(["^1.60.0", "~1.60.0", "1.60", "latest", "", undefined])(
		"refuses a range like %p, which would let the container drift from the captured browsers",
		(version) => {
			expect(() => playwrightImage(version)).toThrow(/pinned to an exact version/);
		},
	);
});

describe("containerisedCommand", () => {
	it("mounts the workspace at its own path, so a baseline resolves to the same file inside", () => {
		const command = containerisedCommand("playwright test", RENDERER, "/work/projects/hutch");

		expect(command).toContain("--volume '/work:/work'");
		expect(command).toContain("--workdir '/work/projects/hutch'");
	});

	it("forwards each named variable by name, so an unset one stays unset inside", () => {
		const command = containerisedCommand("playwright test", RENDERER, "/work/projects/hutch");

		expect(command).toContain("--env HEADLESS --env E2E_PORT");
		expect(command).not.toContain("--env HEADLESS=");
	});

	it("sources the workspace environment before running, as a developer shell would", () => {
		const command = containerisedCommand("playwright test", RENDERER, "/work/projects/hutch");

		expect(command).toContain("cd '/work' && . ./.envrc && cd '/work/projects/hutch' && exec playwright test");
	});

	it("forwards nothing when the phase names no variables", () => {
		const command = containerisedCommand("playwright test", { ...RENDERER, forwardEnv: [] }, "/work/p");

		expect(command).not.toContain("--env");
	});
});
