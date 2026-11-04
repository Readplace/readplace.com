import type { ShownSummary, Viewer } from "@packages/domain/article";
import type { ArticleCrawl } from "./article-crawl";

export type ResolutionAxes = "crawl-and-summary" | "summary";

export type ClaimResolutionOnView = (params: {
	url: string;
	axes: ResolutionAxes;
	viewer: Viewer;
}) => Promise<
	| { kind: "claimed"; crawl: ArticleCrawl; summary: ShownSummary | undefined }
	| { kind: "not-eligible" }
>;
