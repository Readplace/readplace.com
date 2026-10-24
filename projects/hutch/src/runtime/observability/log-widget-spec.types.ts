export interface LogWidgetSpec {
	title: string;
	logGroupNames: readonly string[];
	query: string;
	view: "pie" | "table" | "bar" | "timeSeries";
	x: number;
	y: number;
	width: number;
	height: number;
}
