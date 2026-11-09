import { z } from "zod";

export const SelectionRouteSchema = z.enum(["select", "forward"]);
export type SelectionRoute = z.infer<typeof SelectionRouteSchema>;

export const SELECTION_INGRESS_ENV = [
	"SELECTION_ROUTE",
	"SELECT_ARTICLE_CONTENT_QUEUE_URL",
] as const;
