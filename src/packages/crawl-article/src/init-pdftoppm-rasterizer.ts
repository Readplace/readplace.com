/* c8 ignore start -- thin poppler-utils boundary wrapper, exercised in production at Lambda cold start and in CI via the PDF health canary (scripts/health-sources.ts → arXiv Transformer paper). The child_process calls to pdftoppm/pdfinfo can't be unit-tested without re-implementing them, so all tests stub PdfRasterizer at the OCR consumer (see ocr-pdf.test.ts). */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HutchLogger } from "@packages/hutch-logger";
import type { PdfDocument, PdfPage, PdfRasterizer } from "./pdf-extract.types";

/**
 * 150 DPI matches the rendering resolution the vision model expects:
 * dense math/caption text remains legible while per-page PNGs stay in
 * the 300–500 KB range. Higher DPIs blow up token costs and Lambda
 * memory; lower DPIs lose small-text fidelity.
 */
const DEFAULT_DPI = 150;

interface SpawnResult {
	stdout: string;
	stderr: string;
}

function runCommand(command: string, args: string[]): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
		child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
		child.on("error", reject);
		child.on("close", (code) => {
			const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
			const stderr = Buffer.concat(stderrChunks).toString("utf-8");
			if (code === 0) {
				resolve({ stdout, stderr });
			} else {
				reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
			}
		});
	});
}

interface PdfInfo {
	numPages: number;
	title: string | undefined;
}

function parsePdfInfo(stdout: string): PdfInfo {
	let numPages = 0;
	let title: string | undefined;
	for (const line of stdout.split("\n")) {
		const colonIndex = line.indexOf(":");
		if (colonIndex < 0) continue;
		const key = line.slice(0, colonIndex).trim();
		const value = line.slice(colonIndex + 1).trim();
		if (key === "Pages") {
			numPages = Number.parseInt(value, 10);
		} else if (key === "Title" && value.length > 0) {
			title = value;
		}
	}
	return { numPages, title };
}

/**
 * Renders a PDF to one PNG per page using `pdftoppm` (from poppler-utils),
 * reading page count and title via `pdfinfo`. The Docker image bakes both
 * binaries in via `dnf install poppler-utils`. `open()` rasterises every
 * page up-front into a temp directory; `loadPage(i).renderToPng()` then
 * just reads the corresponding PNG synchronously, keeping the existing
 * batched-render loop in `ocr-pdf.ts` working unchanged. `destroy()` is
 * async so the temp directory can be removed off the hot path.
 */
export function initPdftoppmRasterizer(deps: { logger: HutchLogger; dpi?: number }): PdfRasterizer {
	const dpi = deps.dpi ?? DEFAULT_DPI;
	const { logger } = deps;

	return {
		async open(buffer: Buffer): Promise<PdfDocument> {
			const tStart = Date.now();
			const tempDir = await mkdtemp(join(tmpdir(), "pdftoppm-"));
			const pdfPath = join(tempDir, "input.pdf");
			const pagePrefix = join(tempDir, "page");

			await writeFile(pdfPath, buffer);

			const infoResult = await runCommand("pdfinfo", ["-enc", "UTF-8", pdfPath]);
			const { numPages, title } = parsePdfInfo(infoResult.stdout);
			logger.info(`[pdftoppm] pdfinfo done dt=${Date.now() - tStart}ms pages=${numPages} title=${title ? "yes" : "no"} tempDir=${tempDir}`);

			const tRender = Date.now();
			await runCommand("pdftoppm", ["-png", "-r", String(dpi), pdfPath, pagePrefix]);
			logger.info(`[pdftoppm] rasterised pages=${numPages} dt=${Date.now() - tRender}ms`);

			// pdftoppm zero-pads the page number to the digit-width of numPages
			// (e.g. 3 pages → "page-1.png", 12 pages → "page-01.png").
			const pageDigitWidth = String(numPages).length;

			return {
				numPages,
				loadPage(index: number): PdfPage {
					const pageNumber = String(index + 1).padStart(pageDigitWidth, "0");
					const pagePath = `${pagePrefix}-${pageNumber}.png`;
					return {
						renderToPng(): Buffer {
							return readFileSync(pagePath);
						},
						destroy(): void {},
					};
				},
				getTitle(): string | undefined {
					return title;
				},
				async destroy(): Promise<void> {
					await rm(tempDir, { recursive: true, force: true });
				},
			};
		},
	};
}
/* c8 ignore stop */
