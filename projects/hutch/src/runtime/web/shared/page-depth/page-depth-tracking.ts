/** Imported by the producer (the page that renders the beacon URL), the client
 * that posts to it, and the route that receives it, so the path and the field
 * names cannot drift apart. */
export const PAGE_DEPTH_EVENT_PATH = "/page-depth/event";

export const PAGE_DEPTH_FIELDS = {
	deepest: "deepest",
	height: "height",
	viewport: "viewport",
	exit: "exit",
} as const;
