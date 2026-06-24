import SwiftUI
import WebKit

/// A minimal WKWebView wrapper that loads a single public URL — no cookie
/// injection and no JS bridge, unlike the reader-specific `ReaderWebView`. A
/// navigation delegate reports first-load completion, and failure — a transport
/// error or an HTTP error status — through closures so the presenting view can
/// drive its loading and error overlays. Per the `ReaderWebView`/web-auth
/// precedent, this WKWebView glue is an OS boundary left untested; the URL it
/// loads is discovered by the view model, which is.
struct WebPageView: UIViewControllerRepresentable {
	let url: URL
	let onFinish: () -> Void
	let onFail: () -> Void

	func makeCoordinator() -> Coordinator {
		Coordinator(onFinish: onFinish, onFail: onFail)
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
		private let onFinish: () -> Void
		private let onFail: () -> Void

		init(onFinish: @escaping () -> Void, onFail: @escaping () -> Void) {
			self.onFinish = onFinish
			self.onFail = onFail
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
			if let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 400 {
				decisionHandler(.cancel)
				onFail()
				return
			}
			decisionHandler(.allow)
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
