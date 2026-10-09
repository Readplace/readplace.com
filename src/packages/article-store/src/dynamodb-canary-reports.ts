import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import type {
	CanaryReportKey,
	CanaryReportRow,
	FindCanaryReport,
	SaveCanaryReport,
} from "@packages/provider-contracts/canary-report";
import { z } from "zod";

const CanaryReportItem = z.object({
	reportId: z.string(),
	rowIndex: z.number(),
	runUrl: z.string(),
	createdAt: z.string(),
	url: z.string(),
	labels: z.array(z.string()),
	detail: z.string(),
	savedAt: dynamoField(z.string()),
	contentFetchedAt: dynamoField(z.string()),
});

const MAX_PUTS_IN_FLIGHT = 25;

function reportIdOf(key: CanaryReportKey): string {
	return `${key.canary}/${key.source}`;
}

function toRow(item: z.infer<typeof CanaryReportItem>): CanaryReportRow {
	return {
		url: item.url,
		labels: item.labels,
		detail: item.detail,
		savedAt: item.savedAt,
		contentFetchedAt: item.contentFetchedAt,
	};
}

export function initDynamoDbCanaryReports(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
}): { saveCanaryReport: SaveCanaryReport; findCanaryReport: FindCanaryReport } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: CanaryReportItem,
	});

	const saveCanaryReport: SaveCanaryReport = async (report) => {
		const reportId = reportIdOf(report);
		const items = report.rows.map((row, index) => ({
			reportId,
			rowIndex: index + 1,
			runUrl: report.runUrl,
			createdAt: report.createdAt,
			url: row.url,
			labels: row.labels,
			detail: row.detail,
			...(row.savedAt === undefined ? {} : { savedAt: row.savedAt }),
			...(row.contentFetchedAt === undefined ? {} : { contentFetchedAt: row.contentFetchedAt }),
		}));
		for (let start = 0; start < items.length; start += MAX_PUTS_IN_FLIGHT) {
			await Promise.all(items.slice(start, start + MAX_PUTS_IN_FLIGHT).map((Item) => table.put({ Item })));
		}
	};

	const findCanaryReport: FindCanaryReport = async (key) => {
		const items: z.infer<typeof CanaryReportItem>[] = [];
		await forEachQueryPage(
			table,
			{
				KeyConditionExpression: "reportId = :reportId",
				ExpressionAttributeValues: { ":reportId": reportIdOf(key) },
			},
			async (page) => {
				items.push(...page);
			},
		);
		const [first, ...rest] = items;
		if (first === undefined) return undefined;
		return {
			canary: key.canary,
			source: key.source,
			runUrl: first.runUrl,
			createdAt: first.createdAt,
			rows: [toRow(first), ...rest.map(toRow)],
		};
	};

	return { saveCanaryReport, findCanaryReport };
}
