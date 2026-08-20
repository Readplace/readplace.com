import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import type { Queue } from "./queue.nav";
import { QUEUE_LABEL_MAX_LENGTH, type QueueSlug } from "@packages/domain/queue";
import { type LinkParams, buildQueueUrl } from "./queue.url";

const TEMPLATE = readFileSync(join(__dirname, "queue-nav.template.html"), "utf-8");

export const QUEUE_RENAME_FIELD = "label";

export interface QueueNaming {
	slug: QueueSlug;
	action: string;
}

interface QueueNavNaming {
	isNaming: boolean;
	renameAction?: string;
	renameField?: string;
	maxLength?: number;
}

export interface QueueNavItem extends QueueNavNaming {
	href: string;
	title: string;
	name: string;
	linkClass: string;
	isActive: boolean;
}

export interface QueueNavDisplayModel {
	items: readonly QueueNavItem[];
	newQueueAction: string;
	canCreate: boolean;
}

export function queueNavLinkClass(isActive: boolean): string {
	return `queue-nav__link${isActive ? " queue-nav__link--active" : ""}`;
}

function navNaming(naming: QueueNaming | undefined, slug: QueueSlug): QueueNavNaming {
	if (naming?.slug !== slug) return { isNaming: false };
	return {
		isNaming: true,
		renameAction: naming.action,
		renameField: QUEUE_RENAME_FIELD,
		maxLength: QUEUE_LABEL_MAX_LENGTH,
	};
}

export function buildQueueNav(input: {
	queues: readonly Queue[];
	activeSlug: QueueSlug;
	linkParams: LinkParams;
	newQueueAction: string;
	canCreate: boolean;
	naming?: QueueNaming;
}): QueueNavDisplayModel {
	const naming = input.canCreate ? input.naming : undefined;
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
			...navNaming(naming, queue.slug),
		})),
		newQueueAction: input.newQueueAction,
		canCreate: input.canCreate,
	};
}

export function renderQueueNav(displayModel: QueueNavDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
