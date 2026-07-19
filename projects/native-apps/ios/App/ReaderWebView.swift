import SwiftUI
import UIKit
import WebKit

/// Presents the server's authenticated reader in a WKWebView — the app acting as
/// a browser over the server's HTML. The reader page and its in-reader XHRs are
/// cookie-session authenticated, so the prefetched session cookie is injected
/// into the web view's cookie store before the first navigation. A small injected
/// script reports back when the reader's own mark-read request completes (an XHR
/// a navigation delegate can't observe), so the sheet can close and the row can
/// leave the list. WKWebView (in-process) is required over SFSafariViewController
/// because only it allows cookie injection and a JS bridge; `AuthWebView` is the
/// existing precedent.
struct ReaderWebView: UIViewControllerRepresentable {
	let url: URL
	let cookies: [HTTPCookie]
	let onMarkedRead: () -> Void
	let onClose: () -> Void
	/// The account page deleted the account, so the server destroyed every session
	/// and redirected here rather than to the logged-out home — the sheet dismisses
	/// and the app signs itself out instead of rendering marketing chrome in-sheet.
	let onLogout: () -> Void
	/// Injected so the composition point wires the live browser and tests inject
	/// their own; there is deliberately no internal default.
	let externalBrowser: ExternalBrowser
	/// Reports the page's load lifecycle (provisional → commit → finish/fail plus
	/// live `estimatedProgress`) so the sheet can drive its skeleton and progress
	/// bar. The reader page load is otherwise invisible to the sheet.
	let onLoadPhaseChange: (ReaderLoadPhase) -> Void

	func makeCoordinator() -> Coordinator {
		Coordinator(
			onMarkedRead: onMarkedRead,
			onClose: onClose,
			onLogout: onLogout,
			externalBrowser: externalBrowser,
			onLoadPhaseChange: onLoadPhaseChange
		)
	}

	func makeUIViewController(context: Context) -> UIViewController {
		let controller = UIViewController()

		let userContent = WKUserContentController()
		// The server's chromeless reader posts the mark-read message itself; the app
		// only registers the handler and reacts. It injects no script, so it holds no
		// knowledge of the reader front-end's htmx internals.
		userContent.add(context.coordinator, name: ReaderBridge.messageName)

		let configuration = WKWebViewConfiguration()
		configuration.userContentController = userContent
		// The persistent, process-wide default store: state written inside one open
		// must survive to the next one. Two dismissals depend on it — the share
		// hint's localStorage flag, and the changelog banner's cookie, which the
		// reader's own no-JS dismiss form POSTs so an announcement waved away on one
		// article stays away on the next. The session cookie also persists here, but
		// it is re-injected per open (below) and wiped on sign-out.
		configuration.websiteDataStore = .default()

		let webView = WKWebView(frame: .zero, configuration: configuration)
		webView.customUserAgent = AppConfig.webViewUserAgent
		webView.allowsBackForwardNavigationGestures = true
		webView.navigationDelegate = context.coordinator
		webView.uiDelegate = context.coordinator
		// Let the sheet's system background show through until the page paints, so
		// the moment the skeleton lifts there is no white flash before the first
		// paint (mirrors `WebPageView`).
		webView.isOpaque = false
		webView.backgroundColor = .systemBackground
		controller.view = webView

		// Observe the load before the first navigation starts so the sheet's bar
		// tracks it from zero.
		context.coordinator.observeProgress(of: webView)

		// Inject every prefetched session cookie into the web view's own store before
		// the first navigation, so the reader and its in-reader XHRs are
		// authenticated from the first request. The client forwards whatever the
		// bootstrap set rather than picking one by name, so a server cookie change
		// needs no app release.
		Task { @MainActor in
			let cookieStore = webView.configuration.websiteDataStore.httpCookieStore
			for cookie in cookies {
				await cookieStore.setCookie(cookie)
			}
			webView.load(URLRequest(url: url))
		}
		return controller
	}

	func updateUIViewController(_ controller: UIViewController, context: Context) {}

	static func dismantleUIViewController(_ controller: UIViewController, coordinator: Coordinator) {
		coordinator.invalidate()
	}

	final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
		private let onMarkedRead: () -> Void
		private let onClose: () -> Void
		private let onLogout: () -> Void
		private let externalBrowser: ExternalBrowser
		private let onLoadPhaseChange: (ReaderLoadPhase) -> Void
		private var handled = false
		private var progressObservation: NSKeyValueObservation?
		/// Whether the main frame has committed (started painting) and whether the
		/// load has already reached a terminal outcome. The first terminal outcome
		/// wins: a later navigation on the same view (an in-page link, a
		/// back/forward swipe) must not re-show the skeleton over a good page.
		private var committed = false
		private var terminal = false

		init(
			onMarkedRead: @escaping () -> Void,
			onClose: @escaping () -> Void,
			onLogout: @escaping () -> Void,
			externalBrowser: ExternalBrowser,
			onLoadPhaseChange: @escaping (ReaderLoadPhase) -> Void
		) {
			self.onMarkedRead = onMarkedRead
			self.onClose = onClose
			self.onLogout = onLogout
			self.externalBrowser = externalBrowser
			self.onLoadPhaseChange = onLoadPhaseChange
		}

		/// KVO on `estimatedProgress` (delivered on the main thread) advances the
		/// bar. No `.initial` option: the handler must not fire synchronously while
		/// the view is being built. Provisional progress is unreliable — it spikes to
		/// 1.0 and drops back before the main frame commits — so the bar only tracks
		/// it once committed; before that the skeleton covers the wait.
		func observeProgress(of webView: WKWebView) {
			progressObservation = webView.observe(\.estimatedProgress) { [weak self] webView, _ in
				guard let self, self.committed else { return }
				self.emit(ReaderLoad.rendering(estimatedProgress: webView.estimatedProgress))
			}
		}

		func invalidate() {
			progressObservation?.invalidate()
		}

		/// Reports an in-flight phase unless the load already settled.
		private func emit(_ phase: ReaderLoadPhase) {
			guard !terminal else { return }
			onLoadPhaseChange(phase)
		}

		func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
			committed = false
			emit(.loading)
		}

		func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
			// Content is now painting, so the skeleton lifts here — not at
			// `didFinish`, which can lag far behind first paint (or never arrive for
			// a hung subresource) and would strand the skeleton over a rendered page.
			committed = true
			emit(ReaderLoad.rendering(estimatedProgress: webView.estimatedProgress))
		}

		func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
			guard !terminal else { return }
			terminal = true
			onLoadPhaseChange(.finished)
		}

		func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
			handleFailure(error)
		}

		func webView(
			_ webView: WKWebView,
			didFailProvisionalNavigation navigation: WKNavigation!,
			withError error: Error
		) {
			handleFailure(error)
		}

		/// A cancellation the reader provokes (a redirect superseding the first
		/// navigation, an external link opened in Chrome) is not a page-load
		/// failure, so it neither settles the load nor shows the error view — the
		/// redirected navigation's commit/finish still resolves it.
		private func handleFailure(_ error: Error) {
			guard !terminal, ReaderLoad.isRealFailure(error: error) else { return }
			terminal = true
			onLoadPhaseChange(.failed)
		}

		func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
			guard !handled, ReaderBridge.isMarkedRead(message: message.name, body: message.body) else { return }
			handled = true
			onMarkedRead()
		}

		func webView(
			_ webView: WKWebView,
			decidePolicyFor navigationAction: WKNavigationAction,
			decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
		) {
			guard let url = navigationAction.request.url else {
				decisionHandler(.allow)
				return
			}
			switch ReaderNavigation.decide(
				url: url,
				navigationType: navigationAction.navigationType,
				currentURL: webView.url
			) {
			case .allow:
				decisionHandler(.allow)
			case .close:
				decisionHandler(.cancel)
				onClose()
			case .logout:
				// Cancelled, so WebKit never tries to resolve the custom scheme.
				decisionHandler(.cancel)
				onLogout()
			case let .openExternally(target):
				decisionHandler(.cancel)
				// Chrome-first for our own links (the changelog banner's "Read more"),
				// like login: most users browse in Chrome but leave Safari as the OS
				// default, so the default browser has no Readplace session. An article's
				// link to someone else's site is opened untouched — see `chromeURLFor`.
				openURLChromeFirst(target, browser: externalBrowser)
			}
		}

		/// Without a UI delegate WKWebView suppresses JS dialogs and answers
		/// `false`, so a server page that gates an action behind `window.confirm()`
		/// would silently do nothing in-app. The panel-kind → dialog mapping is the
		/// pure, unit-tested `WebDialog`; these hand the native answer straight to
		/// WebKit's completion handler (exactly once on every path — `WebDialog`'s
		/// contract). `prompt()` is deliberately unimplemented: no server page
		/// uses it, and the suppressed default (nil) is the correct refusal.
		func webView(
			_ webView: WKWebView,
			runJavaScriptConfirmPanelWithMessage message: String,
			initiatedByFrame frame: WKFrameInfo,
			completionHandler: @escaping (Bool) -> Void
		) {
			presentWebDialog(.confirm(message: message), over: webView) { completionHandler($0) }
		}

		func webView(
			_ webView: WKWebView,
			runJavaScriptAlertPanelWithMessage message: String,
			initiatedByFrame frame: WKFrameInfo,
			completionHandler: @escaping () -> Void
		) {
			presentWebDialog(.alert(message: message), over: webView) { _ in completionHandler() }
		}
	}
}

/// Presents a dialog as a native alert over the web view, answering exactly
/// once on every path. The web view lives inside a SwiftUI sheet, so the
/// presenter is the window's topmost presented controller (the sheet's hosting
/// controller), not the root — the root is already presenting, so presenting
/// from it would silently fail and leave the page's script hanging on an
/// unanswered handler. A web view with no window (mid-dismissal) answers
/// `unpresentedAnswer` instead of presenting nowhere or crashing.
func presentWebDialog(_ dialog: WebDialog, over webView: WKWebView, answer: @escaping (Bool) -> Void) {
	guard var presenter = webView.window?.rootViewController else {
		answer(dialog.unpresentedAnswer)
		return
	}
	while let presented = presenter.presentedViewController {
		presenter = presented
	}
	let alert = UIAlertController(title: nil, message: dialog.message, preferredStyle: .alert)
	for choice in dialog.choices {
		alert.addAction(UIAlertAction(title: choice.title, style: choice.style) { _ in
			answer(choice.answer)
		})
	}
	presenter.present(alert, animated: true)
}

/// The native side of the reader's mark-read bridge. The reader's mark-read is an
/// htmx form whose XHR never triggers a navigation, so a `WKNavigationDelegate`
/// can't observe it. Rather than the app injecting a script that sniffs the
/// front-end's htmx events, the server's chromeless reader posts the message
/// itself (the htmx coupling stays on the server that owns htmx); the app only
/// registers this handler and interprets the message. The pure message parser is
/// unit-tested; the WKWebView glue that registers and receives it is left untested
/// (OS boundary), like `AuthWebView` before it.
enum ReaderBridge {
	static let messageName = "readplaceReader"

	/// Whether a received bridge message reports a completed mark-read. Pure and
	/// unit-tested.
	static func isMarkedRead(message name: String, body: Any) -> Bool {
		guard name == messageName, let payload = body as? [String: Any] else { return false }
		return payload["type"] as? String == "markedRead"
	}
}
