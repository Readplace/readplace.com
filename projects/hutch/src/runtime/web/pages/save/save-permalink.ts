import { z } from "zod";

const DEFAULT_BASE_URL = "https://readplace.com";

const UrlSchema = z.url();

type UtmParams = {
	utmSource: string;
	utmContent: string;
};

const PRESETS = new Map<string, UtmParams>([
	["medium-top", { utmSource: "fagnerbrack.com", utmContent: "top" }],
	["medium-bottom", { utmSource: "fagnerbrack.com", utmContent: "bottom" }],
	["bdd-top", { utmSource: "beyond-the-demo", utmContent: "top" }],
	["bdd-bottom", { utmSource: "beyond-the-demo", utmContent: "bottom" }],
]);

export function buildSavePermalink(params: {
	baseUrl: string;
	url: string;
	utmSource: string;
	utmContent: string;
}): string {
	const query = [
		`utm_source=${encodeURIComponent(params.utmSource)}`,
		`utm_content=${encodeURIComponent(params.utmContent)}`,
	].join("&");
	return `${params.baseUrl}/view/${encodeURIComponent(params.url)}?${query}`;
}

type CliIO = {
	argv: readonly string[];
	stdout: { write(chunk: string): void };
	stderr: { write(chunk: string): void };
};

export function runSavePermalinkCli(io: CliIO): number {
	const [presetArg, urlArg] = io.argv;
	const availablePresets = [...PRESETS.keys()].join(", ");

	if (!presetArg || !urlArg) {
		io.stderr.write("Usage: permalink <preset> <url>\n");
		io.stderr.write(`Presets: ${availablePresets}\n`);
		return 1;
	}

	const preset = PRESETS.get(presetArg);
	if (!preset) {
		io.stderr.write(`Unknown preset: ${presetArg}\n`);
		io.stderr.write(`Presets: ${availablePresets}\n`);
		return 1;
	}

	const parsed = UrlSchema.safeParse(urlArg);
	if (!parsed.success) {
		io.stderr.write(`Invalid URL: ${urlArg}\n`);
		return 1;
	}

	const permalink = buildSavePermalink({
		baseUrl: DEFAULT_BASE_URL,
		url: parsed.data,
		utmSource: preset.utmSource,
		utmContent: preset.utmContent,
	});
	io.stdout.write(`${permalink}\n`);
	return 0;
}
