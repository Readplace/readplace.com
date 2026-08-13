import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import type { Queue, QueueName } from "./queue.nav";
import { buildQueueUrl } from "./queue.url";

const TEMPLATE = readFileSync(join(__dirname, "queue-nav.template.html"), "utf-8");

export interface QueueNavItem {
	href: string;
	title: string;
	name: QueueName;
}

export interface QueueNavDisplayModel {
	items: readonly QueueNavItem[];
}

export function buildQueueNav(input: { queues: readonly Queue[] }): QueueNavDisplayModel {
	return {
		items: input.queues.map((queue) => ({
			href: withInternalTracking(buildQueueUrl({}), {
				source: "queue-nav",
				content: `queue-${queue.name}`,
			}),
			title: queue.title,
			name: queue.name,
		})),
	};
}

export function renderQueueNav(displayModel: QueueNavDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
