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

			if let action = page.action(named: "save-content"),
				let payload = await resolveContentPayload(captured: captured, url: url) {
				let result = try await api.saveContent(action: action, url: urlString,
					content: payload.bytes, mediaType: payload.mediaType, title: title)
				return result.usedFallback ? .savedLinkOnly : .savedWithContent
			}
			if let action = page.action(named: "save-article") {
				_ = try await api.saveArticle(action: action, url: urlString)
				return .savedLinkOnly
			}
			return .noSaveAction
		} catch let APIError.refused(messages) {
			return .refused(messages)
		} catch {
			let message = (error as? LocalizedError)?.errorDescription ?? "Save failed."
			return .failed(message)
		}
	}

	/// The bytes and media type to upload via `save-content`, or nil when there is
	/// nothing uploadable so the caller degrades to a URL-only save. A PDF is
	/// fetched directly (the captor never renders it) and accepted only when the
	/// bytes carry the `%PDF-` magic header, so a 200-but-not-a-PDF response (a
	/// bot-defence challenge page, say) degrades cleanly rather than uploading
	/// junk. HTML uses the bytes the captor already rendered.
	private func resolveContentPayload(captured: CapturedPage, url: URL) async -> (bytes: Data, mediaType: String)? {
		if captured.mediaType == "application/pdf" {
			guard let (bytes, _) = await api.fetchExternalContent(url),
				bytes.starts(with: Data("%PDF-".utf8)) else { return nil }
			return (bytes, "application/pdf")
		}
		if let html = captured.rawHtml, !html.isEmpty { return (Data(html.utf8), "text/html") }
		return nil
	}
}
