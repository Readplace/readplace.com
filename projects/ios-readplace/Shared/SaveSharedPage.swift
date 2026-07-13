import Foundation

/// The result of attempting to save a shared page. Decoupled from any UI so the
/// orchestration can be driven directly by tests and mapped to status messages
/// by the share-sheet shell.
enum SaveSharedOutcome: Equatable {
	case savedWithContent
	case savedLinkOnly
	case notLoggedIn
	/// The token store could not be READ (not merely empty) — the shared Keychain
	/// returned a hard failure. Carries the `OSStatus` so the shell can name it,
	/// rather than telling a signed-in user they are signed out.
	case storageUnavailable(OSStatus)
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

	/// `sharedPdf` lazily loads the bytes of a PDF the share sheet delivered as a
	/// file (nil when the payload carried none) — a closure rather than the bytes
	/// so a share that fails the guards above never pays for the load. `onNotice`
	/// receives any server-authored save notice (the queue collection's
	/// `noticeMessages`) as soon as the list loads — before the slow capture and
	/// upload — so the shell can surface it for the whole phase the user must not
	/// interrupt. Defaults to a no-op so the outcome-only callers stay untouched.
	func run(
		url: URL?,
		fallbackTitle: String?,
		sharedPdf: (() async -> Data?)?,
		onNotice: @escaping ([ServerMessage]) -> Void = { _ in }
	) async -> SaveSharedOutcome {
		switch store.loadTokens() {
		case .failure(let error):
			return .storageUnavailable(error.status)
		case .success(nil):
			return .notLoggedIn
		case .success:
			break
		}
		guard let url else { return .noLink }

		do {
			// Load the list first, then hand the server's save notice to the shell,
			// so the caption is on screen before the capture and upload below — the
			// phase during which swiping the extension away would kill the save.
			let page = try await api.loadQueue()
			onNotice(page.noticeMessages)

			var providedPdf: Data?
			if let sharedPdf {
				providedPdf = await sharedPdf().flatMap { $0.starts(with: Self.pdfMagic) ? $0 : nil }
			}
			let captured = providedPdf == nil ? await captor.capture(url: url) : nil
			let title = (captured?.title?.isEmpty == false) ? captured?.title : fallbackTitle

			let urlString = url.absoluteString

			if let action = page.action(named: "save-content"),
				let payload = await resolveContentPayload(captured: captured, url: url, providedPdf: providedPdf) {
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

	private static let pdfMagic = Data("%PDF-".utf8)

	/// The bytes and media type to upload via `save-content`, or nil when there is
	/// nothing uploadable so the caller degrades to a URL-only save. A PDF the
	/// share sheet already delivered as a file is uploaded as-is — no render, no
	/// refetch a bot-defended origin could block. A PDF the captor only detected
	/// is fetched directly, and either way the bytes must carry the `%PDF-` magic
	/// header, so a 200-but-not-a-PDF response (a bot-defence challenge page, say)
	/// degrades cleanly rather than uploading junk. HTML uses the bytes the captor
	/// already rendered.
	private func resolveContentPayload(captured: CapturedPage?, url: URL, providedPdf: Data?) async -> (bytes: Data, mediaType: String)? {
		if let providedPdf { return (providedPdf, "application/pdf") }
		if captured?.mediaType == "application/pdf" {
			guard let bytes = await api.fetchExternalContent(url),
				bytes.starts(with: Self.pdfMagic) else { return nil }
			return (bytes, "application/pdf")
		}
		if let html = captured?.rawHtml, !html.isEmpty { return (Data(html.utf8), "text/html") }
		return nil
	}
}
