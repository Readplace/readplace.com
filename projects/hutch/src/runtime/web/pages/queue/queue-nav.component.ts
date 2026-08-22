import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import type { Queue } from "./queue.nav";
import { DEFAULT_QUEUE_SLUG, QUEUE_LABEL_MAX_LENGTH, type QueueSlug } from "@packages/domain/queue";
import { type LinkParams, buildQueueUrl, queueRenamePath, queueReturnQuery } from "./queue.url";

const TEMPLATE = readFileSync(join(__dirname, "queue-nav.template.html"), "utf-8");

const QUEUE_RENAME_FIELD = "label";

interface QueueNavRename {
	isRenameable: boolean;
	renameAction?: string;
	renameField?: string;
	maxLength?: number;
}

export interface QueueNavItem extends QueueNavRename {
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

function navRename(input: {
	slug: QueueSlug;
	isActive: boolean;
	canRename: boolean;
	linkParams: LinkParams;
}): QueueNavRename {
	const isRenameable =
		input.canRename && input.isActive && input.slug !== DEFAULT_QUEUE_SLUG;
	if (!isRenameable) return { isRenameable: false };
	return {
		isRenameable: true,
		renameAction: `${queueRenamePath(input.slug)}${queueReturnQuery({}, input.linkParams)}`,
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
}): QueueNavDisplayModel {
	return {
		items: input.queues.map((queue) => {
			const isActive = queue.slug === input.activeSlug;
			return {
				href: withInternalTracking(buildQueueUrl({ queue: queue.slug }, input.linkParams), {
					source: "queue-nav",
					content: `queue-${queue.slug}`,
				}),
				title: queue.label,
				name: queue.slug,
				linkClass: queueNavLinkClass(isActive),
				isActive,
				...navRename({
					slug: queue.slug,
					isActive,
					canRename: input.canCreate,
					linkParams: input.linkParams,
				}),
			};
		}),
		newQueueAction: input.newQueueAction,
		canCreate: input.canCreate,
	};
}

export function renderQueueNav(displayModel: QueueNavDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
