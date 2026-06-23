import SwiftUI
import WebKit

/// Presents the server's authenticated reader (`/queue/{id}/view`) — Readplace
/// reader content plus the AI summary — in a WKWebView. The reader page and its
/// htmx poll/mutation XHRs are cookie-session authenticated, so the prefetched
/// `hutch_sid` cookie is injected into the web view's cookie store before the
/// first navigation. A small injected script reports back when the reader's own
/// "Mark as read" htmx request completes, so the sheet can close and the row can
/// leave the unread list. WKWebView (in-process) is required over
/// SFSafariViewController because only it allows cookie injection and a JS
/// bridge; `AuthWebView` is the existing precedent.
struct ReaderWebView: UIViewControllerRepresentable {
	let presentation: ReaderPresentation
	let onMarkedRead: () -> Void

	func makeCoordinator() -> Coordinator {
		Coordinator(onMarkedRead: onMarkedRead)
	}

	func makeUIViewController(context: Context) -> UIViewController {
		let controller = UIViewController()

		let userContent = WKUserContentController()
		userContent.add(context.coordinator, name: ReaderBridge.messageName)
		userContent.addUserScript(WKUserScript(
			source: ReaderBridge.script,
			injectionTime: .atDocumentEnd,
			forMainFrameOnly: true
		))

		let configuration = WKWebViewConfiguration()
		configuration.userContentController = userContent

		let webView = WKWebView(frame: .zero, configuration: configuration)
		webView.customUserAgent = AppConfig.webViewUserAgent
		webView.allowsBackForwardNavigationGestures = true
		controller.view = webView

		guard let url = readerURL(baseURL: AppConfig.serverBaseURL, readHref: presentation.readHref) else {
			return controller
		}
		// Inject the prefetched session cookie before the first navigation, so the
		// reader page and its in-reader poll XHRs are authenticated and never
		// bounce to /login.
		configuration.websiteDataStore.httpCookieStore.setCookie(presentation.cookie) {
			webView.load(URLRequest(url: url))
		}
		return controller
	}

	func updateUIViewController(_ controller: UIViewController, context: Context) {}

	final class Coordinator: NSObject, WKScriptMessageHandler {
		private let onMarkedRead: () -> Void
		private var handled = false

		init(onMarkedRead: @escaping () -> Void) {
			self.onMarkedRead = onMarkedRead
		}

		func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
			guard !handled, ReaderBridge.isMarkedRead(message: message.name, body: message.body) else { return }
			handled = true
			onMarkedRead()
		}
	}
}

/// Builds the reader URL from the server-declared read href, which may be
/// absolute or root-relative. Pure and unit-tested; mirrors `ReadplaceAPI`'s
/// href resolution.
func readerURL(baseURL: String, readHref: String) -> URL? {
	if readHref.hasPrefix("http") { return URL(string: readHref) }
	if readHref.hasPrefix("/") { return URL(string: "\(baseURL)\(readHref)") }
	return URL(string: "\(baseURL)/\(readHref)")
}

/// The JS↔native bridge for the reader. The reader's "Mark as read" control is
/// an `hx-boost` form (an htmx XHR), which never triggers a navigation, so a
/// `WKNavigationDelegate` can't observe it — the script listens for htmx's swap
/// event instead. The pure message parser is unit-tested; the WKWebView glue
/// that registers and receives the message is left untested (OS boundary).
enum ReaderBridge {
	static let messageName = "readplaceReader"

	/// Cancels the htmx swap for a successful mark-read POST (so the queue HTML
	/// this request redirects to never flashes into the reader sheet) and signals
	/// the native side, which closes the sheet and drops the row from the list.
	static let script = """
	(function () {
	  function isMarkRead(detail) {
	    var cfg = (detail && detail.requestConfig) || {};
	    var verb = (cfg.verb || '').toString().toUpperCase();
	    var path = (cfg.path || '').toString().split('?')[0];
	    var xhr = (detail && detail.xhr) || {};
	    return verb === 'POST' && /\\/status$/.test(path) && xhr.status >= 200 && xhr.status < 400;
	  }
	  document.body.addEventListener('htmx:beforeSwap', function (event) {
	    if (!isMarkRead(event.detail)) { return; }
	    event.detail.shouldSwap = false;
	    window.webkit.messageHandlers.readplaceReader.postMessage({ type: 'markedRead' });
	  });
	})();
	"""

	/// Whether a received bridge message reports a completed mark-read. Pure and
	/// unit-tested.
	static func isMarkedRead(message name: String, body: Any) -> Bool {
		guard name == messageName, let payload = body as? [String: Any] else { return false }
		return payload["type"] as? String == "markedRead"
	}
}
