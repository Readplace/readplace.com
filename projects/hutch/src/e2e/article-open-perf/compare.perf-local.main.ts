import fs from "node:fs";
import path from "node:path";
import { getEnv, requireEnv } from "@packages/require-env";
import { compareArms, formatComparisonTable } from "./article-open-comparison";
import {
	ArticleOpenReportSchema,
	articleOpenReportPaths,
} from "./article-open-latency";

const LEFT_LABEL = requireEnv("PERF_ARTICLE_OPEN_LEFT");
const RIGHT_LABEL = requireEnv("PERF_ARTICLE_OPEN_RIGHT");

function readReport(label: string) {
	const paths = articleOpenReportPaths({
		root: getEnv("CI_ARTIFACT_ROOT"),
		runId: getEnv("GITHUB_RUN_ID"),
		label,
	});
	return ArticleOpenReportSchema.parse(JSON.parse(fs.readFileSync(paths.samples, "utf-8")));
}

const left = readReport(LEFT_LABEL);
const right = readReport(RIGHT_LABEL);
const table = formatComparisonTable({
	left: left.label,
	right: right.label,
	rows: compareArms({ left, right }),
});
const destination = articleOpenReportPaths({
	root: getEnv("CI_ARTIFACT_ROOT"),
	runId: getEnv("GITHUB_RUN_ID"),
	label: `${left.label}-vs-${right.label}`,
}).table;
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(
	destination,
	`# Article open latency — ${left.label} vs ${right.label}\n\n${table}\n`,
);
process.stdout.write(`${table}\n\n${destination}\n`);
