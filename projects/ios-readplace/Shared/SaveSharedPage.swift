import Foundation

/// The result of attempting to save a shared page. Decoupled from any UI so the
/// orchestration can be driven directly by tests and mapped to status messages
/// by the share-sheet shell.
enum SaveSharedOutcome: Equatable {
	case savedWithContent
	case savedLinkOnly
	case notLoggedIn
	case noLink
	case noSaveAction
	case refused([ServerMessage])
	case failed(String)
}

/// Renders a page to its HTML. Abstracted so a test can supply a canned page
/// instead of driving a real (and non-deterministic) WKWebView.
@MainActor
protocol HTMLCapturing {
	func capture(url: URL) async -> CapturedPage
}

/// The share-sheet save journey, lifted out of `ShareViewController` so the full
/// decision tree runs against the real API and token types under test — only the
/// UIKit shell and the WKWebView are left behind in the extension target.
///
/// Capture the page → list the queue → when HTML was captured, attempt the
/// content save and let the server decide (it routes an over-its-cap payload to
/// the URL-only fallback it advertises); when no HTML was captured, save the URL
/// only; if the server offered no save action, give up.
@MainActor
struct SaveSharedPage {
	let store: TokenStore
	let api: ReadplaceAPI
	let captor: HTMLCapturing

	func run(url: URL?, fallbackTitle: String?) async -> SaveSharedOutcome {
		guard store.isLoggedIn else { return .notLoggedIn }
		guard let url else { return .noLink }

		let captured = await captor.capture(url: url)
		let title = (captured.title?.isEmpty == false) ? captured.title : fallbackTitle

		do {
			let page = try await api.loadQueue()
			let urlString = url.absoluteString

			if let html = captured.rawHtml, let action = page.action(named: "save-html") {
				let result = try await api.saveHTML(action: action, url: urlString, rawHtml: html, title: title)
				return result.usedFallback ? .savedLinkOnly : .savedWithContent
			} else if let action = page.action(named: "save-article") {
				_ = try await api.saveArticle(action: action, url: urlString)
				return .savedLinkOnly
			} else {
				return .noSaveAction
			}
		} catch let APIError.refused(messages) {
			return .refused(messages)
		} catch {
			let message = (error as? LocalizedError)?.errorDescription ?? "Save failed."
			return .failed(message)
		}
	}
}
