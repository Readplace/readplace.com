/* c8 ignore start -- thin headless-browser wrapper, exercised by the pipeline-health canary */
import puppeteer, { type Browser, type HTTPResponse, type LaunchOptions, type Page, type Target, TargetType, TimeoutError } from "puppeteer-core";
import type { ClassifyRenderedDocument } from "./classify-rendered-document";
import { browserLaunchArgs } from "./browser-launch-args";
import type { RenderOutcome, RenderPage } from "./render-page.types";
import { type CreateRenderRequestFilter, isMainFrameNavigation } from "./render-request-filter";

const PROTOCOL_MARGIN_MILLISECONDS = 10_000;
const CONTENT_DEADLINE_MILLISECONDS = 10_000;
const CLOSE_DEADLINE_MILLISECONDS = 5_000;
const NETWORK_QUIET_MILLISECONDS = 1_000;

const DEADLINE_PASSED = Symbol("deadline-passed");

async function withinDeadline<T>(work: Promise<T>, milliseconds: number): Promise<T | typeof DEADLINE_PASSED> {
	let timer: NodeJS.Timeout | undefined;
	const deadline = new Promise<typeof DEADLINE_PASSED>((resolve) => {
		timer = setTimeout(() => resolve(DEADLINE_PASSED), milliseconds);
	});
	try {
		return await Promise.race([work, deadline]);
	} finally {
		clearTimeout(timer);
	}
}

async function closeBrowser(browser: Browser): Promise<void> {
	const closed = await withinDeadline(browser.close().catch(() => undefined), CLOSE_DEADLINE_MILLISECONDS);
	if (closed === DEADLINE_PASSED) browser.process()?.kill("SIGKILL");
}

const STRAY_PAGE_TYPES = new Set<TargetType>([TargetType.PAGE, TargetType.BACKGROUND_PAGE]);
const STRAY_WORKER_TYPES = new Set<TargetType>([TargetType.SERVICE_WORKER, TargetType.SHARED_WORKER]);

async function closeTarget(target: Target): Promise<void> {
	if (STRAY_PAGE_TYPES.has(target.type())) await (await target.page())?.close();
	if (STRAY_WORKER_TYPES.has(target.type())) await (await target.worker())?.close();
}

function closeStrayTargets(renderPage: Page) {
	return (target: Target) => {
		if (target === renderPage.target()) return;
		closeTarget(target).catch(() => undefined);
	};
}

export function initPuppeteerRenderPage(deps: {
	executablePath: () => Promise<string>;
	launchArgs: readonly string[];
	headless: LaunchOptions["headless"];
	createRenderRequestFilter: CreateRenderRequestFilter;
	classifyRenderedDocument: ClassifyRenderedDocument;
}): RenderPage {
	return async ({ url, egress, navigationTimeoutMilliseconds }) => {
		let browser: Browser | undefined;
		let mainDocument: HTTPResponse | undefined;
		const requestFilter = deps.createRenderRequestFilter({ proxied: egress.kind !== "direct" });
		const failed = (detail: string): RenderOutcome =>
			mainDocument === undefined
				? { kind: "failed", detail, requests: requestFilter.tally() }
				: { kind: "failed", detail, httpStatus: mainDocument.status(), requests: requestFilter.tally() };
		try {
			browser = await puppeteer.launch({
				executablePath: await deps.executablePath(),
				headless: deps.headless,
				protocolTimeout: navigationTimeoutMilliseconds + PROTOCOL_MARGIN_MILLISECONDS,
				args: browserLaunchArgs({ inheritedArgs: deps.launchArgs, egress }),
			});
			const page = await browser.newPage();
			browser.on("targetcreated", closeStrayTargets(page));
			page.on("dialog", (dialog) => {
				dialog.dismiss().catch(() => undefined);
			});
			await page.setBypassServiceWorker(true);
			if (egress.kind !== "direct") await page.authenticate({ username: egress.proxy.username, password: egress.proxy.password });
			await page.setRequestInterception(true);
			page.on("request", (request) => {
				if (request.isInterceptResolutionHandled()) return;
				requestFilter
					.shouldAbortRequest({ url: request.url(), resourceType: request.resourceType(), isNavigation: isMainFrameNavigation(request, page.mainFrame()) })
					.then((abort) => (abort ? request.abort("blockedbyclient") : request.continue()))
					.catch(() => undefined);
			});
			page.on("response", (response) => {
				if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
					mainDocument = response;
				}
			});
			const navigationDeadline = Date.now() + navigationTimeoutMilliseconds;
			try {
				await page.goto(url, { waitUntil: "load", timeout: navigationTimeoutMilliseconds });
				await page.waitForNetworkIdle({
					idleTime: NETWORK_QUIET_MILLISECONDS,
					timeout: Math.max(1, navigationDeadline - Date.now()),
				});
			} catch (error) {
				if (!(error instanceof TimeoutError)) throw error;
			}
			const html = await withinDeadline(page.content(), CONTENT_DEADLINE_MILLISECONDS);
			if (html === DEADLINE_PASSED) return failed(`page did not serialise within ${CONTENT_DEADLINE_MILLISECONDS} ms`);
			if (mainDocument === undefined) return failed("no main document response");
			return {
				...deps.classifyRenderedDocument({
					httpStatus: mainDocument.status(),
					headers: mainDocument.headers(),
					html,
					finalUrl: page.url(),
				}),
				requests: requestFilter.tally(),
			};
		} catch (error) {
			return failed(error instanceof Error ? error.message : String(error));
		} finally {
			if (browser) await closeBrowser(browser);
		}
	};
}
/* c8 ignore stop */
