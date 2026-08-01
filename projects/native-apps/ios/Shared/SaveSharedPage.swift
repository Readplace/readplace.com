import Foundation

/// The result of attempting to save a shared page. Decoupled from any UI so the
/// orchestration can be driven directly by tests and mapped to status messages
/// by the share-sheet shell.
enum SaveSharedOutcome: Equatable {
	/// The link is on the server, with whatever confirmation the server asked the
	/// reader be told — empty on a server that predates the channel. Content is
	/// not part of this outcome: it rides a background session the sheet does not
	/// wait for, and its loss costs only the enrichment the server's own crawl
	/// would have produced anyway.
	case saved([ServerMessage])
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
	/// Nil when this build has no App Group container to stage a body in, which
	/// costs the enrichment upload and nothing else.
	let staging: UploadStaging?
	let uploads: BackgroundUploading
	/// How long the capture may still finish once the link is already saved. Past
	/// it the share sheet stops waiting: the user has been told "Saved", and the
	/// server's crawl covers the content a slow render would have carried.
	var captureGrace: TimeInterval = 4

	/// `sharedPdf` lazily loads the bytes of a PDF the share sheet delivered as a
	/// file (nil when the payload carried none) — a closure rather than the bytes
	/// so a share that fails the guards above never pays for the load. `onNotice`
	/// receives any server-authored save notice (the queue collection's
	/// `noticeMessages`) as soon as the list loads. `onSaved` fires the moment the
	/// link is on the server — carrying the server's confirmation — which is what
	/// lets the sheet paint the outcome and start its dwell while the content leg
	/// is still running. Both default to no-ops so the outcome-only callers stay
	/// untouched.
	func run(
		url: URL?,
		fallbackTitle: String?,
		sharedPdf: (() async -> Data?)?,
		onNotice: @escaping ([ServerMessage]) -> Void = { _ in },
		onSaved: @escaping ([ServerMessage]) -> Void = { _ in }
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

		// Started before the list round trip rather than after it, so the render —
		// the slowest leg by far — overlaps the network instead of following it.
		let content = Task { await resolveContent(url: url, fallbackTitle: fallbackTitle, sharedPdf: sharedPdf) }
		defer { content.cancel() }

		do {
			let page = try await api.loadQueue()
			onNotice(page.noticeMessages)
			guard let action = page.action(named: "save-article") else { return .noSaveAction }
			let confirmation = try await api.saveArticle(action: action, url: url.absoluteString)
			onSaved(confirmation.messages)
			await handOffContent(page: page, content: content)
			return .saved(confirmation.messages)
		} catch let APIError.refused(messages) {
			return .refused(messages)
		} catch {
			let message = (error as? LocalizedError)?.errorDescription ?? "Save failed."
			return .failed(message)
		}
	}

	private static let pdfMagic = Data("%PDF-".utf8)

	/// Stages the captured content and hands it to the background session, if it
	/// arrives inside the grace window. Everything here is best-effort by design:
	/// the link is already saved, so a missing action, an unstageable body, or a
	/// capture that ran long costs enrichment only — and is never retried, because
	/// the server's crawl is the retry.
	private func handOffContent(page: QueuePage, content: Task<MultipartForm?, Never>) async {
		guard let staging,
			let action = page.action(named: "save-content"),
			let accessToken = store.tokens?.accessToken,
			let form = await firstValue(of: content, within: captureGrace),
			let file = try? await staging.stage(form),
			let request = BackgroundUpload.request(
				action: action,
				baseURL: api.baseURL,
				contentType: form.contentType,
				accessToken: accessToken
			)
		else { return }
		uploads.upload(request, fromFile: file)
	}

	/// The multipart body to upload, or nil when there is nothing uploadable. A PDF
	/// the share sheet already delivered as a file is used as-is — no render, no
	/// refetch a bot-defended origin could block. A PDF the captor only detected is
	/// fetched directly, and either way the bytes must carry the `%PDF-` magic
	/// header, so a 200-but-not-a-PDF response (a bot-defence challenge page, say)
	/// yields nothing rather than uploading junk. HTML uses the bytes the captor
	/// already rendered.
	private func resolveContent(
		url: URL,
		fallbackTitle: String?,
		sharedPdf: (() async -> Data?)?
	) async -> MultipartForm? {
		if let sharedPdf, let bytes = await sharedPdf(), bytes.starts(with: Self.pdfMagic) {
			return saveContentForm(url: url, bytes: bytes, mediaType: "application/pdf", title: fallbackTitle)
		}
		let captured = await captor.capture(url: url)
		let title = (captured.title?.isEmpty == false) ? captured.title : fallbackTitle
		if captured.mediaType == "application/pdf" {
			guard let bytes = await api.fetchExternalContent(url), bytes.starts(with: Self.pdfMagic) else { return nil }
			return saveContentForm(url: url, bytes: bytes, mediaType: "application/pdf", title: title)
		}
		guard let html = captured.rawHtml, !html.isEmpty else { return nil }
		return saveContentForm(url: url, bytes: Data(html.utf8), mediaType: "text/html", title: title)
	}
}

/// The `save-content` fields in wire order, boundary included, so the body that is
/// staged and the `Content-Type` the request declares can never disagree.
func saveContentForm(url: URL, bytes: Data, mediaType: String, title: String?) -> MultipartForm {
	var textParts = [
		MultipartForm.TextPart(name: "url", value: url.absoluteString),
		MultipartForm.TextPart(name: "mediaType", value: mediaType),
	]
	if let title, !title.isEmpty { textParts.append(MultipartForm.TextPart(name: "title", value: title)) }
	return MultipartForm(
		boundary: UUID().uuidString,
		textParts: textParts,
		filePart: MultipartForm.FilePart(name: "content", filename: "content", bytes: bytes)
	)
}

/// The task's value, or nil when `seconds` elapse first. The loser is abandoned
/// rather than awaited: a WKWebView render cannot be interrupted, so awaiting it
/// would hold the share sheet open long past the window it was given.
@MainActor
private func firstValue<Value>(of task: Task<Value?, Never>, within seconds: TimeInterval) async -> Value? {
	let claim = FirstClaim()
	return await withCheckedContinuation { (continuation: CheckedContinuation<Value?, Never>) in
		let deadline = Task { @MainActor in
			try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
			if claim.take() { continuation.resume(returning: nil) }
		}
		Task { @MainActor in
			let value = await task.value
			deadline.cancel()
			if claim.take() { continuation.resume(returning: value) }
		}
	}
}

/// One-shot gate so exactly one racer resumes the continuation. Shared with the
/// share sheet, which races the reader's dismissal against the journey settling.
@MainActor
final class FirstClaim {
	private var taken = false

	func take() -> Bool {
		defer { taken = true }
		return !taken
	}
}
