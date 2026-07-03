import UIKit
import WebKit

/// The rendered page content captured from a WKWebView, plus the media type of
/// the loaded main-frame resource (`text/html` for a rendered page,
/// `application/pdf` for a PDF the captor declined to render, nil when the load
/// failed before a response). The media type lets the save journey pick the
/// matching `save-content` upload instead of degrading every non-HTML resource
/// to a URL-only crawl.
struct CapturedPage {
	let rawHtml: String?
	let title: String?
	let mediaType: String?
}

/// Loads a URL in an off-screen WKWebView and returns the rendered DOM as
/// `document.documentElement.outerHTML` plus `document.title` — the same
/// content the browser extension captures and uploads via `save-content`.
///
/// Resolves on first main-frame load completion (after a short settle delay so
/// script-rendered content is present) or when the timeout elapses, whichever
/// comes first. Never throws: a failed load yields a `CapturedPage` with nil
/// fields so the caller can degrade to a URL-only save.
@MainActor
final class HTMLCaptor: NSObject, WKNavigationDelegate {
	/// Host this (hidden) in a view so the web content reliably lays out and runs JS.
	let webView: WKWebView

	private var continuation: CheckedContinuation<CapturedPage, Never>?
	private var timeoutTask: Task<Void, Never>?
	private var settleSeconds: Double = 0.4
	private var detectedMediaType: String?

	override init() {
		let configuration = WKWebViewConfiguration()
		configuration.defaultWebpagePreferences.allowsContentJavaScript = true
		webView = WKWebView(
			frame: CGRect(x: 0, y: 0, width: 414, height: 896),
			configuration: configuration
		)
		super.init()
		webView.navigationDelegate = self
		webView.customUserAgent = AppConfig.webViewUserAgent
	}

	func capture(url: URL, timeout: TimeInterval) async -> CapturedPage {
		await withCheckedContinuation { continuation in
			self.continuation = continuation
			self.timeoutTask = Task { [weak self] in
				try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
				await self?.finish(extractContent: true)
			}
			webView.load(URLRequest(url: url))
		}
	}

	// Records the main-frame resource's media type before deciding whether to
	// render it. A PDF is cancelled rather than loaded — a large PDF would blow
	// the share extension's memory budget — and finished as a non-extract capture
	// so the save journey fetches the bytes itself and uploads them as a file.
	// Setting `detectedMediaType` before `.cancel` (which provokes a
	// didFailProvisionalNavigation re-entry) means the media type is already
	// stamped no matter which path resolves `finish` first.
	nonisolated func webView(
		_ webView: WKWebView,
		decidePolicyFor navigationResponse: WKNavigationResponse,
		decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
	) {
		let decision = Self.navigationResponseDecision(
			mimeType: navigationResponse.response.mimeType,
			isMainFrame: navigationResponse.isForMainFrame
		)
		Task { @MainActor [weak self] in
			guard let self else { return decisionHandler(.allow) }
			switch decision {
			case .allow(let detectedMediaType):
				if let detectedMediaType { self.detectedMediaType = detectedMediaType }
				decisionHandler(.allow)
			case .captureAsFile(let mediaType):
				self.detectedMediaType = mediaType
				decisionHandler(.cancel)
				await self.finish(extractContent: false)
			}
		}
	}

	enum NavigationResponseDecision: Equatable {
		case allow(detectedMediaType: String?)
		case captureAsFile(mediaType: String)
	}

	nonisolated static func navigationResponseDecision(mimeType: String?, isMainFrame: Bool) -> NavigationResponseDecision {
		guard isMainFrame else { return .allow(detectedMediaType: nil) }
		if mimeType == "application/pdf" { return .captureAsFile(mediaType: "application/pdf") }
		return .allow(detectedMediaType: mimeType)
	}

	// WKNavigationDelegate's requirements are nonisolated; these hop to the main
	// actor (where WebKit already calls them) to touch the actor-isolated state.
	nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
		Task { @MainActor [weak self] in
			guard let self else { return }
			try? await Task.sleep(nanoseconds: UInt64(self.settleSeconds * 1_000_000_000))
			await self.finish(extractContent: true)
		}
	}

	nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
		Task { @MainActor [weak self] in await self?.finish(extractContent: true) }
	}

	nonisolated func webView(
		_ webView: WKWebView,
		didFailProvisionalNavigation navigation: WKNavigation!,
		withError error: Error
	) {
		Task { @MainActor [weak self] in await self?.finish(extractContent: false) }
	}

	private func finish(extractContent: Bool) async {
		guard let continuation else { return }
		self.continuation = nil
		timeoutTask?.cancel()
		timeoutTask = nil

		var page = CapturedPage(rawHtml: nil, title: nil, mediaType: detectedMediaType)
		if extractContent {
			let html = (try? await webView.evaluateJavaScript("document.documentElement.outerHTML")) as? String
			let title = (try? await webView.evaluateJavaScript("document.title")) as? String
			page = CapturedPage(rawHtml: html, title: title, mediaType: "text/html")
		}
		webView.stopLoading()
		continuation.resume(returning: page)
	}
}

extension HTMLCaptor: HTMLCapturing {
	/// The orchestrator-facing capture, pinned to the production timeout.
	func capture(url: URL) async -> CapturedPage { await capture(url: url, timeout: 12) }
}
