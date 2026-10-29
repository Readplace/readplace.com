import Foundation

@MainActor
func openURLWithHandoff(_ url: URL, browser: ExternalBrowser, mint: () async throws -> String) async {
	guard chromeURLFor(url) != nil else {
		browser.open(url) { _ in }
		return
	}
	guard let code = try? await mint(),
		let handoff = browserHandoffURL(for: url, code: code, baseURL: AppConfig.serverBaseURL),
		let chrome = chromeURLFor(handoff) else {
		openURLChromeFirst(url, browser: browser)
		return
	}
	let openedInChrome = await withCheckedContinuation { continuation in
		browser.open(chrome) { continuation.resume(returning: $0) }
	}
	if openedInChrome { return }
	guard let freshCode = try? await mint(),
		let freshHandoff = browserHandoffURL(for: url, code: freshCode, baseURL: AppConfig.serverBaseURL) else {
		browser.open(url) { _ in }
		return
	}
	browser.open(freshHandoff) { _ in }
}
