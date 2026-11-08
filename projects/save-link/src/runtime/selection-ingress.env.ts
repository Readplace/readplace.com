export type SelectionRoute = "select" | "forward";

export const SELECTION_INGRESS_ENV = [
	"SELECTION_ROUTE",
	"SELECT_ARTICLE_CONTENT_QUEUE_URL",
] as const;
