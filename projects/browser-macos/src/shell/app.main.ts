import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	app,
	BrowserWindow,
	ipcMain,
	Menu,
	net,
	protocol,
	type WebContents,
} from "electron";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { buildMenuTemplate } from "../core/app-menu";
import { normalizeAddress } from "../core/normalize-address";
import {
	buildReaderDocument,
	buildStartDocument,
} from "../core/reader-document";
import { buildFailureDocument } from "../core/reader-failure";
import {
	articleUrlFromReaderUrl,
	isReaderUrl,
	READER_SCHEME,
	toReaderUrl,
} from "../core/reader-location";
import { initReaderPipeline } from "../core/reader-pipeline";
import { internetReaderUserAgent } from "../core/user-agent";

const APP_NAME = "Internet Reader";
const logger = HutchLogger.from(consoleLogger);
const readerCss = readFileSync(join(__dirname, "reader.css"), "utf-8");

// Reader extraction fetches through Chromium's network stack (net.fetch),
// not Node's undici. It does proper Happy Eyeballs (so a dead IPv6 route
// doesn't stall the request) and presents the same TLS fingerprint as the
// live-browsing webview — the right base for the crawl personas to ride on.
// Resolved lazily because net.fetch is only callable after app `ready`.
const readerFetch: typeof globalThis.fetch = (input, init) =>
	net.fetch(input instanceof URL ? input.href : input, init);

const pipeline = initReaderPipeline({
	fetch: readerFetch,
	logError: (message, error) => logger.error(message, error),
});

// The custom scheme that serves reader-view pages must be treated as a
// standard, secure origin so Chromium gives it normal session history (Back /
// Forward / Reload) and lets the page fetch images over https.
protocol.registerSchemesAsPrivileged([
	{
		scheme: READER_SCHEME,
		privileges: { standard: true, secure: true, supportFetchAPI: true },
	},
]);

const viewsByHostId = new Map<number, WebContents>();

function isHttpUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

function htmlResponse(body: string): Response {
	return new Response(body, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

async function handleReaderRequest(request: Request): Promise<Response> {
	const articleUrl = articleUrlFromReaderUrl(request.url);
	if (!articleUrl) return htmlResponse(buildStartDocument(readerCss));

	const result = await pipeline.loadArticle(articleUrl);
	if (result.ok) {
		return htmlResponse(
			buildReaderDocument({
				article: {
					title: result.article.title,
					siteName: result.article.siteName,
					content: result.article.content,
					wordCount: result.article.wordCount,
				},
				url: articleUrl,
				css: readerCss,
			}),
		);
	}
	return htmlResponse(
		buildFailureDocument({ url: articleUrl, reason: result.reason, css: readerCss }),
	);
}

function loadInReader(view: WebContents, articleUrl: string): void {
	void view.loadURL(toReaderUrl(articleUrl));
}

function viewForSender(sender: WebContents): WebContents | undefined {
	return viewsByHostId.get(sender.id);
}

function focusedView(): WebContents | undefined {
	const win = BrowserWindow.getFocusedWindow();
	return win ? viewsByHostId.get(win.webContents.id) : undefined;
}

function pushNavState(host: WebContents, view: WebContents): void {
	const current = view.getURL();
	host.send("ir:nav-state", {
		displayUrl: current === "" ? "" : displayAddress(current),
		canGoBack: view.navigationHistory.canGoBack(),
		canGoForward: view.navigationHistory.canGoForward(),
		isReader: isReaderUrl(current),
		loading: view.isLoadingMainFrame(),
	});
}

function displayAddress(location: string): string {
	const article = articleUrlFromReaderUrl(location);
	if (article) return article;
	return isReaderUrl(location) ? "" : location;
}

function toggleReader(view: WebContents): void {
	const current = view.getURL();
	const article = articleUrlFromReaderUrl(current);
	if (article) {
		void view.loadURL(article);
		return;
	}
	if (isHttpUrl(current)) loadInReader(view, current);
}

function attachWebview(view: WebContents): void {
	const host = view.hostWebContents;
	if (!host) return;
	viewsByHostId.set(host.id, view);
	view.setUserAgent(app.userAgentFallback);

	view.setWindowOpenHandler(({ url }) => {
		if (isHttpUrl(url)) loadInReader(view, url);
		return { action: "deny" };
	});

	view.on("will-navigate", (event, url) => {
		// Keep link clicks from a reader page inside reader view instead of
		// silently dropping to the live page.
		if (isReaderUrl(view.getURL()) && isHttpUrl(url)) {
			event.preventDefault();
			loadInReader(view, url);
		}
	});

	view.on("page-title-updated", (_event, title) => {
		BrowserWindow.fromWebContents(host)?.setTitle(title === "" ? APP_NAME : title);
	});

	const notify = (): void => pushNavState(host, view);
	view.on("did-navigate", notify);
	view.on("did-navigate-in-page", notify);
	view.on("did-start-loading", notify);
	view.on("did-stop-loading", notify);
	view.on("destroyed", () => viewsByHostId.delete(host.id));
}

function createWindow(): void {
	const window = new BrowserWindow({
		width: 1180,
		height: 860,
		minWidth: 720,
		minHeight: 480,
		title: APP_NAME,
		backgroundColor: "#ffffff",
		titleBarStyle: "hiddenInset",
		webPreferences: {
			preload: join(__dirname, "preload.main.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webviewTag: true,
		},
	});
	void window.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

function buildAppMenu(): Menu {
	return Menu.buildFromTemplate(
		buildMenuTemplate({
			appName: APP_NAME,
			isMac: process.platform === "darwin",
			actions: {
				reload: () => focusedView()?.reload(),
				back: () => {
					const view = focusedView();
					if (view?.navigationHistory.canGoBack()) view.navigationHistory.goBack();
				},
				forward: () => {
					const view = focusedView();
					if (view?.navigationHistory.canGoForward())
						view.navigationHistory.goForward();
				},
				toggleReader: () => {
					const view = focusedView();
					if (view) toggleReader(view);
				},
				focusAddressBar: () =>
					BrowserWindow.getFocusedWindow()?.webContents.send("ir:focus-address"),
				newWindow: () => createWindow(),
			},
		}),
	);
}

app.on("web-contents-created", (_event, contents) => {
	if (contents.getType() === "webview") attachWebview(contents);
});

ipcMain.handle("ir:navigate", (event, input: string) => {
	const view = viewForSender(event.sender);
	const result = normalizeAddress(input);
	if (!result.ok) return { ok: false, reason: result.reason };
	if (view) loadInReader(view, result.url);
	return { ok: true };
});

ipcMain.on("ir:back", (event) => {
	const view = viewForSender(event.sender);
	if (view?.navigationHistory.canGoBack()) view.navigationHistory.goBack();
});

ipcMain.on("ir:forward", (event) => {
	const view = viewForSender(event.sender);
	if (view?.navigationHistory.canGoForward()) view.navigationHistory.goForward();
});

ipcMain.on("ir:reload", (event) => {
	viewForSender(event.sender)?.reload();
});

ipcMain.on("ir:toggle-reader", (event) => {
	const view = viewForSender(event.sender);
	if (view) toggleReader(view);
});

app
	.whenReady()
	.then(() => {
		app.setName(APP_NAME);
		// Dock icon for the dev run (`pnpm start`); the packaged .app gets the
		// same mark from build/icon.icns via electron-packager's --icon.
		app.dock?.setIcon(join(__dirname, "icon.png"));
		app.userAgentFallback = internetReaderUserAgent({
			appVersion: app.getVersion(),
			chromeVersion: process.versions.chrome ?? "0.0.0",
		});
		protocol.handle(READER_SCHEME, handleReaderRequest);
		Menu.setApplicationMenu(buildAppMenu());
		createWindow();
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	})
	.catch((error: unknown) => {
		logger.error("[InternetReader] failed to start", error);
	});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
