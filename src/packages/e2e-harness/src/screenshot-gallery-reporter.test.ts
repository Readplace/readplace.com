import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ScreenshotGalleryReporter from "./screenshot-gallery-reporter";

type Workspace = { projectRoot: string; testDir: string };

async function createWorkspace(): Promise<Workspace> {
	const projectRoot = await mkdtemp(path.join(tmpdir(), "screenshot-gallery-"));
	const testDir = path.join(projectRoot, "src", "e2e");
	await mkdir(testDir, { recursive: true });
	return { projectRoot, testDir };
}

async function commitBaseline(workspace: Workspace, relativePath: string, pixels: string): Promise<void> {
	const file = path.join(workspace.testDir, relativePath);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, pixels);
}

function startedReporter(workspace: Workspace, outputFolder = "./test-results/screenshot-gallery") {
	const reporter = new ScreenshotGalleryReporter({ outputFolder, configDir: workspace.projectRoot });
	reporter.onBegin({
		projects: [{ name: "chromium", testDir: workspace.testDir, snapshotDir: workspace.testDir }],
	});
	return reporter;
}

function galleryFolder(workspace: Workspace): string {
	return path.join(workspace.projectRoot, "test-results", "screenshot-gallery");
}

async function readGallery(workspace: Workspace): Promise<string> {
	return readFile(path.join(galleryFolder(workspace), "index.html"), "utf-8");
}

function sectionOf(html: string, spec: string): string {
	const start = html.indexOf(`data-gallery-spec="${spec}"`);
	assert.notEqual(start, -1, `gallery must have a section for ${spec}`);
	return html.slice(start, html.indexOf("</section>", start));
}

function columnHeadings(section: string): string[] {
	return [...section.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((match) => match[1]);
}

function rowsOf(section: string): { state: string; cells: { src: string; caption: string }[][] }[] {
	return [...section.matchAll(/<tr><th scope="row">([^<]*)<\/th>(.*?)<\/tr>/g)].map((row) => ({
		state: row[1],
		cells: [...row[2].matchAll(/<td>(.*?)<\/td>/g)].map((cell) =>
			[...cell[1].matchAll(/<img src="([^"]+)"[^>]*><\/a><figcaption>([^<]+)<\/figcaption>/g)].map((figure) => ({
				src: figure[1],
				caption: figure[2],
			})),
		),
	}));
}

async function pixelsAt(workspace: Workspace, src: string): Promise<string> {
	return readFile(path.join(galleryFolder(workspace), src), "utf-8");
}

describe("ScreenshotGalleryReporter", () => {
	let workspace: Workspace;

	beforeEach(async () => {
		workspace = await createWorkspace();
	});

	afterEach(async () => {
		await rm(workspace.projectRoot, { recursive: true, force: true });
	});

	it("lays every checkpoint of a spec out by state, with width and theme columns, from committed baselines alone", async () => {
		const snapshots = "gmail-imports-visual.e2e-local.ts-snapshots";
		await commitBaseline(workspace, `${snapshots}/imports-running-mobile-dark-chromium.png`, "running mobile dark");
		await commitBaseline(workspace, `${snapshots}/imports-running-desktop-light-chromium.png`, "running desktop light");
		await commitBaseline(workspace, `${snapshots}/imports-running-mobile-light-chromium.png`, "running mobile light");
		await commitBaseline(workspace, `${snapshots}/imports-running-desktop-dark-chromium.png`, "running desktop dark");
		await commitBaseline(workspace, `${snapshots}/imports-consent-desktop-light-chromium.png`, "consent desktop light");
		const reporter = startedReporter(workspace);

		await reporter.onEnd({ status: "passed" });

		const section = sectionOf(await readGallery(workspace), "gmail-imports-visual.e2e-local.ts");
		expect(columnHeadings(section)).toEqual([
			"State",
			"desktop · light",
			"desktop · dark",
			"mobile · light",
			"mobile · dark",
		]);
		const rows = rowsOf(section);
		expect(rows.map((row) => row.state)).toEqual(["imports-consent", "imports-running"]);
		expect(rows[0].cells.map((cell) => cell.length)).toEqual([1, 0, 0, 0]);
		const running = await Promise.all(
			rows[1].cells.map(async ([figure]) => ({ caption: figure.caption, pixels: await pixelsAt(workspace, figure.src) })),
		);
		expect(running).toEqual([
			{ caption: "Committed baseline", pixels: "running desktop light" },
			{ caption: "Committed baseline", pixels: "running desktop dark" },
			{ caption: "Committed baseline", pixels: "running mobile light" },
			{ caption: "Committed baseline", pixels: "running mobile dark" },
		]);
	});

	it("shows this run's successful captures and failure diffs beside the baseline of the same checkpoint", async () => {
		const snapshots = "admin-visual.e2e-local.ts-snapshots";
		await commitBaseline(workspace, `${snapshots}/admin-index-desktop-light-chromium.png`, "baseline index");
		await commitBaseline(workspace, `${snapshots}/admin-conflict-desktop-light-chromium.png`, "baseline conflict");
		const failureDiffDir = path.join(workspace.projectRoot, "test-results", "admin-conflict");
		await mkdir(failureDiffDir, { recursive: true });
		await writeFile(path.join(failureDiffDir, "actual.png"), "actual conflict");
		await writeFile(path.join(failureDiffDir, "diff.png"), "diff conflict");
		const reporter = startedReporter(workspace);

		reporter.onTestEnd(
			{ location: { file: path.join(workspace.testDir, "admin-visual.e2e-local.ts") } },
			{
				status: "passed",
				attachments: [
					{ name: "admin-index-desktop-light.png", contentType: "image/png", body: Buffer.from("captured index") },
					{ name: "trace", contentType: "application/zip", path: path.join(failureDiffDir, "trace.zip") },
					{ name: "screenshot", contentType: "image/png", path: path.join(failureDiffDir, "actual.png") },
				],
			},
		);
		reporter.onTestEnd(
			{ location: { file: path.join(workspace.testDir, "admin-visual.e2e-local.ts") } },
			{
				status: "failed",
				attachments: [
					{
						name: "admin-conflict-desktop-light-actual.png",
						contentType: "image/png",
						path: path.join(failureDiffDir, "actual.png"),
					},
					{
						name: "admin-conflict-desktop-light-diff.png",
						contentType: "image/png",
						path: path.join(failureDiffDir, "diff.png"),
					},
				],
			},
		);
		await reporter.onEnd({ status: "failed" });

		const html = await readGallery(workspace);
		const rows = rowsOf(sectionOf(html, "admin-visual.e2e-local.ts"));
		const described = await Promise.all(
			rows.map(async (row) => ({
				state: row.state,
				figures: await Promise.all(
					row.cells[0].map(async (figure) => `${figure.caption}: ${await pixelsAt(workspace, figure.src)}`),
				),
			})),
		);
		expect(described).toEqual([
			{
				state: "admin-conflict",
				figures: ["Committed baseline: baseline conflict", "Actual: actual conflict", "Difference: diff conflict"],
			},
			{ state: "admin-index", figures: ["Committed baseline: baseline index", "Captured this run: captured index"] },
		]);
		expect(html).toContain(
			"<p data-gallery-summary>Run failed · 2 committed baselines · 1 captured this run · 2 failure images</p>",
		);
	});

	it("shows a baseline written by a passing update run once, beside its capture, with no failure images", async () => {
		const snapshots = "gmail-visual.e2e-local.ts-snapshots";
		const expectedPath = path.join(workspace.testDir, snapshots, "gmail-setup-mobile-dark-chromium.png");
		const actualPath = path.join(workspace.projectRoot, "test-results", "gmail-setup", "gmail-setup-mobile-dark-actual.png");
		await commitBaseline(workspace, `${snapshots}/gmail-setup-mobile-dark-chromium.png`, "written baseline");
		await mkdir(path.dirname(actualPath), { recursive: true });
		await writeFile(actualPath, "written baseline");
		const reporter = startedReporter(workspace);

		reporter.onTestEnd(
			{ location: { file: path.join(workspace.testDir, "gmail-visual.e2e-local.ts") } },
			{
				status: "passed",
				attachments: [
					{ name: "gmail-setup-mobile-dark-expected.png", contentType: "image/png", path: expectedPath },
					{ name: "gmail-setup-mobile-dark-actual.png", contentType: "image/png", path: actualPath },
					{ name: "gmail-setup-mobile-dark.png", contentType: "image/png", body: Buffer.from("captured setup") },
				],
			},
		);
		await reporter.onEnd({ status: "passed" });

		const html = await readGallery(workspace);
		const [row] = rowsOf(sectionOf(html, "gmail-visual.e2e-local.ts"));
		expect(row.state).toBe("gmail-setup");
		expect(row.cells.map((cell) => cell.map((figure) => figure.caption))).toEqual([
			["Committed baseline", "Captured this run"],
		]);
		expect(html).toContain(
			"<p data-gallery-summary>Run passed · 1 committed baselines · 1 captured this run · 0 failure images</p>",
		);
	});

	it("files an unstable screenshot's previous frame under its own checkpoint as a failure image", async () => {
		const reporter = startedReporter(workspace);

		reporter.onTestEnd(
			{ location: { file: path.join(workspace.testDir, "inbox-visual.e2e-local.ts") } },
			{
				status: "failed",
				attachments: [
					{ name: "inbox-list-desktop-light-previous.png", contentType: "image/png", body: Buffer.from("previous frame") },
					{ name: "inbox-list-desktop-light-actual.png", contentType: "image/png", body: Buffer.from("last frame") },
				],
			},
		);
		await reporter.onEnd({ status: "failed" });

		const html = await readGallery(workspace);
		const section = sectionOf(html, "inbox-visual.e2e-local.ts");
		expect(columnHeadings(section)).toEqual(["State", "desktop · light"]);
		const [row] = rowsOf(section);
		expect(row.state).toBe("inbox-list");
		expect(
			await Promise.all(row.cells[0].map(async (figure) => `${figure.caption}: ${await pixelsAt(workspace, figure.src)}`)),
		).toEqual(["Previous: previous frame", "Actual: last frame"]);
		expect(html).toContain(
			"<p data-gallery-summary>Run failed · 0 committed baselines · 0 captured this run · 2 failure images</p>",
		);
	});

	it("keeps each spec in its own section, including specs in nested folders and checkpoints named without a width or theme", async () => {
		await commitBaseline(workspace, "readlist-flow/run.e2e-local.ts-snapshots/readlist-empty-chromium.png", "empty");
		await commitBaseline(workspace, "alert-visual.e2e-local.ts-snapshots/alert-notice-dark-chromium.png", "dark");
		await commitBaseline(workspace, "alert-visual.e2e-local.ts-snapshots/alert-notice-light-chromium.png", "light");
		await commitBaseline(workspace, "alert-visual.e2e-local.ts-snapshots/alert-notice-firefox.png", "other engine");
		await commitBaseline(workspace, "fixtures/logo-chromium.png", "not a baseline");

		const reporter = startedReporter(workspace);
		await reporter.onEnd({ status: "passed" });

		const html = await readGallery(workspace);
		expect([...html.matchAll(/data-gallery-spec="([^"]+)"/g)].map((match) => match[1])).toEqual([
			"alert-visual.e2e-local.ts",
			"readlist-flow/run.e2e-local.ts",
		]);
		expect(columnHeadings(sectionOf(html, "alert-visual.e2e-local.ts"))).toEqual(["State", "light", "dark"]);
		const nested = sectionOf(html, "readlist-flow/run.e2e-local.ts");
		expect(columnHeadings(nested)).toEqual(["State", "Screenshot"]);
		expect(rowsOf(nested).map((row) => row.state)).toEqual(["readlist-empty"]);
		expect(await readdir(path.join(galleryFolder(workspace), "images"))).toHaveLength(3);
	});

	it("replaces the previous run's gallery instead of accumulating stale images", async () => {
		const staleImage = path.join(galleryFolder(workspace), "images", "0000-removed-checkpoint-baseline.png");
		await mkdir(path.dirname(staleImage), { recursive: true });
		await writeFile(staleImage, "stale");
		await commitBaseline(workspace, "a-visual.e2e-local.ts-snapshots/a-state-chromium.png", "fresh");

		const reporter = startedReporter(workspace);
		await reporter.onEnd({ status: "passed" });

		const images = await readdir(path.join(galleryFolder(workspace), "images"));
		expect(await Promise.all(images.map((image) => pixelsAt(workspace, `images/${image}`)))).toEqual(["fresh"]);
	});

	it("writes the gallery to an absolute folder as given", async () => {
		const elsewhere = path.join(workspace.projectRoot, "elsewhere", "gallery");
		const reporter = startedReporter(workspace, elsewhere);

		await reporter.onEnd({ status: "passed" });

		expect((await readdir(elsewhere)).sort()).toEqual(["images", "index.html"]);
	});

	it("says so when there is nothing to show", async () => {
		const reporter = startedReporter(workspace);

		await reporter.onEnd({ status: "passed" });

		expect(await readGallery(workspace)).toContain(
			"<p data-gallery-empty>No screenshots were captured and no baselines are committed.</p>",
		);
	});

	it("escapes checkpoint names so a name cannot break the page markup", async () => {
		const reporter = startedReporter(workspace);
		reporter.onTestEnd(
			{ location: { file: path.join(workspace.testDir, "odd-visual.e2e-local.ts") } },
			{ status: "passed", attachments: [{ name: `<b>"x"&y.png`, contentType: "image/png", body: Buffer.from("odd") }] },
		);

		await reporter.onEnd({ status: "passed" });

		const html = await readGallery(workspace);
		expect(rowsOf(sectionOf(html, "odd-visual.e2e-local.ts")).map((row) => row.state)).toEqual([
			"&lt;b&gt;&quot;x&quot;&amp;y",
		]);
	});

	it("rejects an image attachment that carries neither bytes nor a file", () => {
		const reporter = startedReporter(workspace);

		expect(() =>
			reporter.onTestEnd(
				{ location: { file: path.join(workspace.testDir, "a-visual.e2e-local.ts") } },
				{ status: "passed", attachments: [{ name: "a-state.png", contentType: "image/png" }] },
			),
		).toThrow('image attachment "a-state.png" carries neither a body nor a path');
	});

	it("refuses a configuration that is not the factory's single browser project", () => {
		const reporter = new ScreenshotGalleryReporter({ outputFolder: "gallery", configDir: workspace.projectRoot });
		const project = { name: "chromium", testDir: workspace.testDir, snapshotDir: workspace.testDir };

		expect(() => reporter.onBegin({ projects: [] })).toThrow(
			"the screenshot gallery expects the single browser project the Playwright config factory defines",
		);
		expect(() => reporter.onBegin({ projects: [project, { ...project, name: "firefox" }] })).toThrow(
			"the screenshot gallery expects the single browser project the Playwright config factory defines",
		);
	});

	it("requires the run's configuration before recording a test or writing the gallery", async () => {
		const reporter = new ScreenshotGalleryReporter({ outputFolder: "gallery", configDir: workspace.projectRoot });

		expect(() =>
			reporter.onTestEnd({ location: { file: path.join(workspace.testDir, "a.e2e-local.ts") } }, { status: "passed", attachments: [] }),
		).toThrow("Playwright reports the run's configuration before any test ends");
		await expect(reporter.onEnd({ status: "passed" })).rejects.toThrow(
			"Playwright reports the run's configuration before the run ends",
		);
	});

	it("leaves the terminal to Playwright's own progress reporter", () => {
		const reporter = new ScreenshotGalleryReporter({ outputFolder: "gallery", configDir: workspace.projectRoot });

		expect(reporter.printsToStdio()).toBe(false);
	});
});
