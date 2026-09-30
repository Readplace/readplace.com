import assert from "node:assert";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FullProject, FullResult, Location, Reporter, TestResult } from "@playwright/test/reporter";

type ImageKind = "baseline" | "captured" | "expected" | "previous" | "actual" | "diff";

type ImageSource = { path: string } | { body: Buffer };

interface GalleryImage {
	spec: string;
	checkpoint: string;
	kind: ImageKind;
	source: ImageSource;
}

interface GalleryProject {
	name: string;
	testDir: string;
	snapshotDir: string;
}

interface CheckpointVariant {
	state: string;
	width: string | undefined;
	theme: string | undefined;
}

const KIND_LABELS: Record<ImageKind, string> = {
	baseline: "Committed baseline",
	captured: "Captured this run",
	expected: "Expected",
	previous: "Previous",
	actual: "Actual",
	diff: "Difference",
};

const FAILURE_SUFFIXES = ["expected", "previous", "actual", "diff"] as const satisfies readonly ImageKind[];

const WIDTHS = ["desktop", "mobile"] as const;

const THEMES = ["light", "dark"] as const;

const SNAPSHOTS_DIR_SUFFIX = "-snapshots";

function splitSuffix(name: string, suffixes: readonly string[]): { rest: string; suffix: string | undefined } {
	const suffix = suffixes.find((candidate) => name.endsWith(`-${candidate}`));
	if (suffix === undefined) return { rest: name, suffix: undefined };
	return { rest: name.slice(0, -(suffix.length + 1)), suffix };
}

function variantOf(checkpoint: string): CheckpointVariant {
	const themed = splitSuffix(checkpoint, THEMES);
	const sized = splitSuffix(themed.rest, WIDTHS);
	return { state: sized.rest, width: sized.suffix, theme: themed.suffix };
}

function orderOf(value: string | undefined, order: readonly string[]): number {
	return value === undefined ? order.length : order.indexOf(value);
}

function columnKey(variant: CheckpointVariant): string {
	return [variant.width, variant.theme].filter((part) => part !== undefined).join(" · ");
}

function compareVariants(left: CheckpointVariant, right: CheckpointVariant): number {
	return (
		orderOf(left.width, WIDTHS) - orderOf(right.width, WIDTHS) ||
		orderOf(left.theme, THEMES) - orderOf(right.theme, THEMES)
	);
}

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function fileSafe(text: string): string {
	return text.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function capturedImage(input: { spec: string; attachmentName: string; source: ImageSource }): GalleryImage {
	const checkpointWithKind = input.attachmentName.slice(0, -".png".length);
	const { rest, suffix } = splitSuffix(checkpointWithKind, FAILURE_SUFFIXES);
	const kind = FAILURE_SUFFIXES.find((candidate) => candidate === suffix) ?? "captured";
	return { spec: input.spec, checkpoint: rest, kind, source: input.source };
}

async function committedBaselines(project: GalleryProject): Promise<GalleryImage[]> {
	const baselineSuffix = `-${project.name}.png`;
	const entries = await readdir(project.snapshotDir, { recursive: true });
	return entries
		.filter((entry) => path.dirname(entry).endsWith(SNAPSHOTS_DIR_SUFFIX) && entry.endsWith(baselineSuffix))
		.sort()
		.map((entry) => ({
			spec: path.dirname(entry).slice(0, -SNAPSHOTS_DIR_SUFFIX.length),
			checkpoint: path.basename(entry).slice(0, -baselineSuffix.length),
			kind: "baseline",
			source: { path: path.join(project.snapshotDir, entry) },
		}));
}

function renderFigure(image: GalleryImage & { file: string }): string {
	const label = KIND_LABELS[image.kind];
	return `<figure class="shot shot--${image.kind}"><a href="${escapeHtml(image.file)}"><img src="${escapeHtml(image.file)}" alt="${escapeHtml(`${image.checkpoint} — ${label}`)}" loading="lazy"></a><figcaption>${label}</figcaption></figure>`;
}

function renderSpec(spec: string, images: readonly (GalleryImage & { file: string })[]): string {
	const variants = new Map<string, CheckpointVariant>();
	const rows = new Map<string, Map<string, (GalleryImage & { file: string })[]>>();
	for (const image of images) {
		const variant = variantOf(image.checkpoint);
		const column = columnKey(variant);
		variants.set(column, variant);
		const row = rows.get(variant.state) ?? new Map<string, (GalleryImage & { file: string })[]>();
		rows.set(variant.state, row);
		row.set(column, [...(row.get(column) ?? []), image]);
	}
	const columns = [...variants.entries()].sort(([, left], [, right]) => compareVariants(left, right)).map(([key]) => key);
	const header = columns.map((column) => `<th scope="col">${escapeHtml(column || "Screenshot")}</th>`).join("");
	const body = [...rows.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([state, cells]) => {
			const tds = columns.map((column) => `<td>${(cells.get(column) ?? []).map(renderFigure).join("")}</td>`).join("");
			return `<tr><th scope="row">${escapeHtml(state)}</th>${tds}</tr>`;
		})
		.join("");
	return `<section id="${escapeHtml(`spec-${fileSafe(spec)}`)}" data-gallery-spec="${escapeHtml(spec)}"><h2>${escapeHtml(spec)}</h2><div class="scroll"><table><thead><tr><th scope="col">State</th>${header}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function renderGallery(input: { status: FullResult["status"]; images: readonly (GalleryImage & { file: string })[] }): string {
	const specs = [...new Set(input.images.map((image) => image.spec))].sort((left, right) => left.localeCompare(right));
	const count = (kinds: readonly ImageKind[]) => input.images.filter((image) => kinds.includes(image.kind)).length;
	const summary = `Run ${escapeHtml(input.status)} · ${count(["baseline"])} committed baselines · ${count(["captured"])} captured this run · ${count(FAILURE_SUFFIXES)} failure images`;
	const toc = specs.map((spec) => `<li><a href="#${escapeHtml(`spec-${fileSafe(spec)}`)}">${escapeHtml(spec)}</a></li>`).join("");
	const sections = specs.map((spec) => renderSpec(spec, input.images.filter((image) => image.spec === spec))).join("");
	const content = specs.length === 0 ? `<p data-gallery-empty>No screenshots were captured and no baselines are committed.</p>` : `<nav><ul>${toc}</ul></nav>${sections}`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screenshot gallery</title>
<style>
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1a1a1a; --muted: #5c5c5c; --line: #d9d9d9; --fail: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg: #141414; --fg: #ededed; --muted: #a3a3a3; --line: #3a3a3a; --fail: #f2b8b5; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
h2 { font-size: 1.1rem; margin: 32px 0 8px; overflow-wrap: anywhere; }
header p { color: var(--muted); margin: 0; }
nav ul { columns: 18rem; padding-left: 1.2rem; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--line); padding: 8px; vertical-align: top; text-align: left; }
th[scope="row"] { overflow-wrap: anywhere; max-width: 16rem; }
figure { margin: 0 0 8px; }
img { display: block; max-width: 360px; height: auto; border: 1px solid var(--line); }
figcaption { color: var(--muted); font-size: 12px; }
.shot--expected figcaption, .shot--previous figcaption, .shot--actual figcaption, .shot--diff figcaption { color: var(--fail); }
</style>
</head>
<body>
<header><h1>Screenshot gallery</h1><p data-gallery-summary>${summary}</p></header>
${content}
</body>
</html>
`;
}

export default class ScreenshotGalleryReporter implements Reporter {
	private readonly outputFolder: string;
	private project: GalleryProject | undefined;
	private readonly captured: GalleryImage[] = [];

	constructor(options: { outputFolder: string; configDir: string }) {
		this.outputFolder = path.resolve(options.configDir, options.outputFolder);
	}

	printsToStdio(): boolean {
		return false;
	}

	onBegin(config: { projects: readonly Pick<FullProject, "name" | "testDir" | "snapshotDir">[] }): void {
		const [project] = config.projects;
		assert(
			project && config.projects.length === 1,
			"the screenshot gallery expects the single browser project the Playwright config factory defines",
		);
		this.project = { name: project.name, testDir: project.testDir, snapshotDir: project.snapshotDir };
	}

	onTestEnd(
		test: { location: Pick<Location, "file"> },
		result: { status: TestResult["status"]; attachments: readonly TestResult["attachments"][number][] },
	): void {
		assert(this.project, "Playwright reports the run's configuration before any test ends");
		const spec = path.relative(this.project.testDir, test.location.file);
		for (const attachment of result.attachments) {
			if (attachment.contentType !== "image/png" || !attachment.name.endsWith(".png")) continue;
			const source = attachment.body === undefined ? attachment.path : attachment.body;
			assert(source, `image attachment "${attachment.name}" carries neither a body nor a path`);
			const image = capturedImage({
				spec,
				attachmentName: attachment.name,
				source: typeof source === "string" ? { path: source } : { body: source },
			});
			if (result.status === "passed" && image.kind !== "captured") continue;
			this.captured.push(image);
		}
	}

	async onEnd(result: Pick<FullResult, "status">): Promise<void> {
		assert(this.project, "Playwright reports the run's configuration before the run ends");
		const images = [...(await committedBaselines(this.project)), ...this.captured];
		const imagesFolder = path.join(this.outputFolder, "images");
		await rm(this.outputFolder, { recursive: true, force: true });
		await mkdir(imagesFolder, { recursive: true });
		const published = await Promise.all(
			images.map(async (image, index) => {
				const file = `images/${String(index).padStart(4, "0")}-${fileSafe(`${image.spec}-${image.checkpoint}`)}-${image.kind}.png`;
				const destination = path.join(this.outputFolder, file);
				if ("path" in image.source) await copyFile(image.source.path, destination);
				else await writeFile(destination, image.source.body);
				return { ...image, file };
			}),
		);
		await writeFile(path.join(this.outputFolder, "index.html"), renderGallery({ status: result.status, images: published }));
	}
}
