import type {
	CanaryReport,
	CanaryReportKey,
	FindCanaryReport,
	SaveCanaryReport,
} from "@packages/provider-contracts/canary-report";

function keyOf(key: CanaryReportKey): string {
	return `${key.canary}/${key.source}`;
}

export function initInMemoryCanaryReports(): {
	saveCanaryReport: SaveCanaryReport;
	findCanaryReport: FindCanaryReport;
} {
	const reports = new Map<string, CanaryReport>();

	const saveCanaryReport: SaveCanaryReport = async (report) => {
		reports.set(keyOf(report), report);
	};

	const findCanaryReport: FindCanaryReport = async (key) => reports.get(keyOf(key));

	return { saveCanaryReport, findCanaryReport };
}
