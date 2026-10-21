import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PageBody, render } from "@packages/web-shell";
import { ADMIN_DASHBOARD_STYLES } from "./admin-dashboard.styles";
import type {
	AdminDashboardViewModel,
	AdminDashboardsIndexViewModel,
	DashboardTable,
	DashboardWidgetBody,
} from "./admin-dashboard.viewmodel";
import { ADMIN_DASHBOARDS_PATH, adminDashboardPath } from "./admin-dashboards.url";

const TEMPLATE = readFileSync(join(__dirname, "admin-dashboard.template.html"), "utf-8");
const INDEX_TEMPLATE = readFileSync(join(__dirname, "admin-dashboards-index.template.html"), "utf-8");
const TABLE_TEMPLATE = readFileSync(join(__dirname, "admin-dashboard-table.template.html"), "utf-8");
const CHART_TEMPLATE = readFileSync(join(__dirname, "admin-dashboard-chart.template.html"), "utf-8");

const CELL_MODIFIERS = {
	numeric: "admin-dashboard__cell--numeric",
	text: "",
} as const;

const EMPTY_MODIFIERS = {
	empty: "",
	filled: "admin-dashboard__empty--hidden",
} as const;

const ADMIN_SEO = {
	description: "Operator tools. Not for public consumption.",
	robots: "noindex, nofollow",
} as const;

function renderTable(table: DashboardTable): string {
	return render(TABLE_TEMPLATE, {
		columns: table.columns,
		rows: table.rows.map((row) => ({
			cells: row.cells.map((cell) => ({
				...cell,
				modifier: CELL_MODIFIERS[cell.numeric ? "numeric" : "text"],
			})),
		})),
	});
}

function renderBody(body: DashboardWidgetBody): string {
	if (body.view === "table") return renderTable(body.table);
	return render(CHART_TEMPLATE, {
		multiples: body.chart.multiples.map((multiple) => ({ ...multiple, frame: body.chart.frame })),
		tableHtml: renderTable(body.table),
	});
}

export function AdminDashboardPage(viewModel: AdminDashboardViewModel): PageBody {
	const html = render(TEMPLATE, {
		...viewModel,
		widgets: viewModel.widgets.map((widget) => {
			const state = widget.body === undefined ? "empty" : "filled";
			return {
				...widget,
				emptyFlag: state === "empty" ? "true" : "false",
				emptyModifier: EMPTY_MODIFIERS[state],
				bodyHtml: widget.body === undefined ? "" : renderBody(widget.body),
			};
		}),
	});
	return {
		seo: { ...ADMIN_SEO, title: `${viewModel.title} | Dashboards | Admin | Readplace`, canonicalUrl: adminDashboardPath(viewModel.slug) },
		styles: ADMIN_DASHBOARD_STYLES,
		bodyClass: "page-admin-dashboard",
		content: { html },
	};
}

export function AdminDashboardsIndexPage(viewModel: AdminDashboardsIndexViewModel): PageBody {
	return {
		seo: { ...ADMIN_SEO, title: "Dashboards | Admin | Readplace", canonicalUrl: ADMIN_DASHBOARDS_PATH },
		styles: ADMIN_DASHBOARD_STYLES,
		bodyClass: "page-admin-dashboards",
		content: { html: render(INDEX_TEMPLATE, viewModel) },
	};
}
