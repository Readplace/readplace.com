import type { Request, Response, Router } from "express";

export interface QueueTabLink {
	id: string;
	href: string;
	label: string;
	badgeLabel?: string;
}

export interface QueueTab {
	id: string;
	isEnabled(req: Request): boolean;
	filterTab(): QueueTabLink;
	renderPage(req: Request, res: Response): Promise<void>;
	renderCounts(req: Request, res: Response): Promise<void>;
	registerRoutes(router: Router): void;
}

export function activeQueueTab(
	tabs: readonly QueueTab[],
	req: Request,
): QueueTab | undefined {
	const requested = req.query.tab;
	if (typeof requested !== "string") return undefined;
	return tabs.find((tab) => tab.id === requested && tab.isEnabled(req));
}
