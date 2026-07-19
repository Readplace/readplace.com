import SwiftUI
import WebKit

/// A minimal WKWebView wrapper that loads a single public URL — no cookie
/// injection and no JS bridge, unlike the reader-specific `ReaderWebView`. A
/// navigation delegate reports first-load completion, and failure — a transport
/// error or an HTTP error status — through closures so the presenting view can
/// drive its loading and error overlays, and intercepts the page's own
/// `readplace://reader/close` back link to dismiss the sheet. Per the
/// `ReaderWebView`/web-auth precedent, this WKWebView glue is an OS boundary left
/// untested; the URL it loads is discovered by the view model, which is.
struct WebPageView: UIViewControllerRepresentable {
	let url: URL
	/// Invoked when the hosted page activates its "Back to queue" deep link, so the
	/// caller dismisses the sheet — the page renders no chrome of its own.
	let onClose: () -> Void
	let onFinish: () -> Void
	let onFail: () -> Void

	func makeCoordinator() -> Coordinator {
		Coordinator(onClose: onClose, onFinish: onFinish, onFail: onFail)
	}

	func makeUIViewController(context: Context) -> UIViewController {
		let controller = UIViewController()
		let webView = WKWebView(frame: .zero)
		webView.navigationDelegate = context.coordinator
		// Let the sheet's background show through until the page paints, so the
		// load blends into the system light/dark sheet instead of flashing white.
		webView.isOpaque = false
		webView.backgroundColor = .systemBackground
		controller.view = webView
		webView.load(URLRequest(url: url))
		return controller
	}

	func updateUIViewController(_ controller: UIViewController, context: Context) {}

	final class Coordinator: NSObject, WKNavigationDelegate {
		private let onClose: () -> Void
		private let onFinish: () -> Void
		private let onFail: () -> Void

		init(onClose: @escaping () -> Void, onFinish: @escaping () -> Void, onFail: @escaping () -> Void) {
			self.onClose = onClose
			self.onFinish = onFinish
			self.onFail = onFail
		}

		/// The chromeless help page's only navigation is its "Back to queue" deep
		/// link; intercept it to dismiss, reusing the reader's `readplace://reader/close`
		/// contract so the one close link lives in one decision. The page links out
		/// nowhere else, so `ReaderNavigation`'s external/logout branches never fire
		/// here — every other navigation (the initial load) is allowed through.
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
			case .close:
				decisionHandler(.cancel)
				onClose()
			default:
				decisionHandler(.allow)
			}
		}

		/// WKWebView delivers a 4xx/5xx through `didFinish`, not `didFail`, so without
		/// rejecting the response here the sheet would paint the server's error body.
		/// Cancelling routes an error status to `onFail`, surfacing the native Share
		/// fallback instead.
		func webView(
			_ webView: WKWebView,
			decidePolicyFor navigationResponse: WKNavigationResponse,
			decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
		) {
			let statusCode = (navigationResponse.response as? HTTPURLResponse)?.statusCode
			switch WebResponsePolicy.decide(statusCode: statusCode) {
			case .allow:
				decisionHandler(.allow)
			case .fail:
				decisionHandler(.cancel)
				onFail()
			}
		}

		func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
			onFinish()
		}

		func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
			onFail()
		}

		func webView(
			_ webView: WKWebView,
			didFailProvisionalNavigation navigation: WKNavigation!,
			withError error: Error
		) {
			onFail()
		}
	}
}
