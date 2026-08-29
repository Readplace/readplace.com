import Foundation

enum HealBlockedOutcome: Equatable {
	case healed
	case captureWasEmpty
	case noSaveContentAction

	var failureText: String? {
		switch self {
		case .healed:
			return nil
		case .captureWasEmpty:
			return "This device couldn't capture that page either — the site returned nothing to save."
		case .noSaveContentAction:
			return "The server offered no way to save the captured page."
		}
	}
}

@MainActor
struct HealBlockedArticle {
	let api: ReadplaceAPI
	let captor: HTMLCapturing

	func run(url: URL) async throws -> HealBlockedOutcome {
		let captured = await captor.capture(url: url)
		guard let html = captured.rawHtml, !html.isEmpty else { return .captureWasEmpty }
		let page = try await api.loadReadlist()
		guard let action = page.action(named: "save-content") else { return .noSaveContentAction }
		try await api.saveContent(
			action: action,
			form: saveContentForm(url: url, bytes: Data(html.utf8), mediaType: "text/html", title: captured.title)
		)
		return .healed
	}
}
