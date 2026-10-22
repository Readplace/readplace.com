import "../zod-config";
import { z } from "zod";
import { assert } from "../invariant";

export interface Timers {
	after: (ms: number) => Promise<"timeout">;
}

type TabUpdatedListener = (tabId: number, changeInfo: { status?: string }) => void;
type TabRemovedListener = (tabId: number) => void;

export interface HiddenTabApi {
	create: (createProperties: { url: string; active: false; openerTabId?: number }) => Promise<{ id?: number }>;
	remove: (tabId: number) => Promise<void>;
	sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
	onUpdated: {
		addListener(callback: TabUpdatedListener): void;
		removeListener(callback: TabUpdatedListener): void;
	};
	onRemoved: {
		addListener(callback: TabRemovedListener): void;
		removeListener(callback: TabRemovedListener): void;
	};
}

const CaptureHtmlAnswerSchema = z.object({
	rawHtml: z.string(),
	title: z.string(),
	responseStatus: z.number().optional(),
});

export type CaptureHtmlAnswer = z.infer<typeof CaptureHtmlAnswerSchema>;

export type TabLoad = "complete" | "removed";

export interface HiddenTab {
	tabId: number;
	nextLoad: () => Promise<TabLoad>;
	captureHtml: () => Promise<CaptureHtmlAnswer | undefined>;
	close: () => Promise<void>;
}

export type OpenHiddenTab = (params: { url: string; openerTabId?: number }) => Promise<HiddenTab>;

export function initOpenHiddenTab(deps: { tabs: HiddenTabApi; timers: Timers; captureTimeoutMs: number }): OpenHiddenTab {
	return async function openHiddenTab(params) {
		const seenBeforeCreate: { tabId: number; load: TabLoad }[] = [];
		const loads: TabLoad[] = [];
		let ownTabId: number | undefined;
		let awaitingLoad: ((load: TabLoad) => void) | undefined;

		function deliver(load: TabLoad): void {
			const resolve = awaitingLoad;
			if (!resolve) {
				loads.push(load);
				return;
			}
			awaitingLoad = undefined;
			resolve(load);
		}

		function record(event: { tabId: number; load: TabLoad }): void {
			if (ownTabId === undefined) {
				seenBeforeCreate.push(event);
				return;
			}
			if (event.tabId === ownTabId) deliver(event.load);
		}

		const onUpdated: TabUpdatedListener = (tabId, changeInfo) => {
			if (changeInfo.status === "complete") record({ tabId, load: "complete" });
		};
		const onRemoved: TabRemovedListener = (tabId) => record({ tabId, load: "removed" });

		function detach(): void {
			deps.tabs.onUpdated.removeListener(onUpdated);
			deps.tabs.onRemoved.removeListener(onRemoved);
		}

		deps.tabs.onUpdated.addListener(onUpdated);
		deps.tabs.onRemoved.addListener(onRemoved);
		const tabId = await deps.tabs
			.create({ url: params.url, active: false, openerTabId: params.openerTabId })
			.then((created) => {
				assert(created.id !== undefined, `The hidden tab for ${params.url} was created without an id`);
				return created.id;
			})
			.catch((error: unknown) => {
				detach();
				throw error;
			});
		ownTabId = tabId;
		loads.push(...seenBeforeCreate.filter((event) => event.tabId === tabId).map((event) => event.load));

		return {
			tabId,

			nextLoad() {
				const buffered = loads.shift();
				if (buffered) return Promise.resolve(buffered);
				return new Promise<TabLoad>((resolve) => {
					awaitingLoad = resolve;
				});
			},

			async captureHtml() {
				const reply = await Promise.race([
					deps.tabs.sendMessage(tabId, { type: "capture-html" }).catch(() => undefined),
					deps.timers.after(deps.captureTimeoutMs),
				]);
				const answer = CaptureHtmlAnswerSchema.safeParse(reply);
				return answer.success ? answer.data : undefined;
			},

			async close() {
				detach();
				await deps.tabs.remove(tabId);
			},
		};
	};
}
