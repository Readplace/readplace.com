import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import type { Queue } from "./queue.nav";
import type { QueueSlug } from "@packages/domain/queue";
import { type LinkParams, buildQueueUrl } from "./queue.url";

const TEMPLATE = readFileSync(join(__dirname, "queue-nav.template.html"), "utf-8");

export interface QueueNavItem {
	href: string;
	title: string;
	name: string;
	linkClass: string;
	isActive: boolean;
}

export interface QueueNavDisplayModel {
	items: readonly QueueNavItem[];
	newQueueHref: string;
	canCreate: boolean;
}

export function queueNavLinkClass(isActive: boolean): string {
	return `queue-nav__link${isActive ? " queue-nav__link--active" : ""}`;
}

export function buildQueueNav(input: {
	queues: readonly Queue[];
	activeSlug: QueueSlug;
	linkParams: LinkParams;
	newQueueHref: string;
	canCreate: boolean;
}): QueueNavDisplayModel {
	return {
		items: input.queues.map((queue) => ({
			href: withInternalTracking(buildQueueUrl({ queue: queue.slug }, input.linkParams), {
				source: "queue-nav",
				content: `queue-${queue.slug}`,
			}),
			title: queue.label,
			name: queue.slug,
			linkClass: queueNavLinkClass(queue.slug === input.activeSlug),
			isActive: queue.slug === input.activeSlug,
		})),
		newQueueHref: input.newQueueHref,
		canCreate: input.canCreate,
	};
}

export function renderQueueNav(displayModel: QueueNavDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
