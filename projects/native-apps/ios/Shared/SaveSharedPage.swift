import Foundation

/// The result of attempting to save a shared page. Decoupled from any UI so the
/// orchestration can be driven directly by tests and mapped to status messages
/// by the share-sheet shell.
enum SaveSharedOutcome: Equatable {
	/// The link is on the server, with whatever confirmation the server asked the
	/// reader be told — empty on a server that predates the channel.
	case saved([ServerMessage])
	case savedAwaitingUpload([ServerMessage])
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
	let jobs: UploadJobStore?
	/// Nil for the same no-container reason as `jobs`, which costs only the app's
	/// automatic list refresh on return.
	let unseenSave: UnseenSave?
	var stillSavingAfter: TimeInterval = 4

	/// `sharedPdf` lazily loads the bytes of a PDF the share sheet delivered as a
	/// file (nil when the payload carried none) — a closure rather than the bytes
	/// so a share that fails the guards above never pays for the load. `onNotice`
	/// receives any server-authored save notice (the readlist collection's
	/// `noticeMessages`) as soon as the list loads. `onSaved` fires the moment the
	/// link is on the server — carrying the server's confirmation. All default to
	/// no-ops so the outcome-only callers stay untouched.
	func run(
		url: URL?,
		fallbackTitle: String?,
		sharedPdf: (() async -> Data?)?,
		onNotice: @escaping ([ServerMessage]) -> Void = { _ in },
		onSaved: @escaping ([ServerMessage]) -> Void = { _ in },
		onStillSaving: @escaping () -> Void = {}
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
			var page = try await api.loadReadlist()
			onNotice(page.noticeMessages)
			guard let action = page.action(named: "save-article") else { return .noSaveAction }
			let confirmation: ReadplaceAPI.SaveConfirmation
			do {
				confirmation = try await api.saveArticle(action: action, url: url.absoluteString)
			} catch let error where !APIError.isRefusalOrAuthFailure(error) {
				page = try await api.rediscoverReadlist()
				guard let rediscovered = page.action(named: "save-article") else { return .noSaveAction }
				confirmation = try await api.saveArticle(action: rediscovered, url: url.absoluteString)
			}
			unseenSave?.record()
			let admitted = await admit(page: page, url: url, title: fallbackTitle)
			onSaved(confirmation.messages)
			guard let jobs, let admitted else { return .saved(confirmation.messages) }

			let stillSaving = Task { @MainActor in
				try await Task.sleep(nanoseconds: UInt64(stillSavingAfter * 1_000_000_000))
				onStillSaving()
			}
			defer { stillSaving.cancel() }
			await persist(await content.value, job: admitted, in: jobs)
			return .savedAwaitingUpload(confirmation.messages)
		} catch let APIError.refused(messages) {
			return .refused(messages)
		} catch {
			let message = (error as? LocalizedError)?.errorDescription ?? "Save failed."
			return .failed(message)
		}
	}

	private static let pdfMagic = Data("%PDF-".utf8)

	private func admit(page: ReadlistPage, url: URL, title: String?) async -> UploadJob? {
		guard let jobs, page.action(named: "save-content") != nil else { return nil }
		let now = Date()
		let job = UploadJob(
			id: UUID().uuidString,
			url: url.absoluteString,
			title: title,
			state: .capturePending(detectedMediaType: nil),
			attempts: 0,
			nextAttemptAt: now,
			createdAt: now
		)
		try? await jobs.admit(job)
		return job
	}

	private func persist(_ content: ResolvedContent, job: UploadJob, in jobs: UploadJobStore) async {
		switch content {
		case .form(let form):
			_ = try? await jobs.stageReady(job, form: form)
		case .pdfDetected:
			try? jobs.update(job.detecting(mediaType: "application/pdf"))
		case .none:
			break
		}
	}

	private enum ResolvedContent {
		case form(MultipartForm)
		case pdfDetected
		case none
	}

	/// A PDF the share sheet already delivered as a file is used as-is — no
	/// render, no refetch a bot-defended origin could block. The bytes must carry
	/// the `%PDF-` magic header, so a payload that is not a PDF yields nothing
	/// rather than uploading junk. HTML uses the bytes the captor already
	/// rendered.
	private func resolveContent(
		url: URL,
		fallbackTitle: String?,
		sharedPdf: (() async -> Data?)?
	) async -> ResolvedContent {
		if let sharedPdf, let bytes = await sharedPdf(), bytes.starts(with: Self.pdfMagic) {
			return .form(saveContentForm(url: url, bytes: bytes, mediaType: "application/pdf", title: fallbackTitle))
		}
		let captured = await captor.capture(url: url)
		let title = (captured.title?.isEmpty == false) ? captured.title : fallbackTitle
		if captured.mediaType == "application/pdf" { return .pdfDetected }
		guard let html = captured.rawHtml, !html.isEmpty else { return .none }
		return .form(saveContentForm(url: url, bytes: Data(html.utf8), mediaType: "text/html", title: title))
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
