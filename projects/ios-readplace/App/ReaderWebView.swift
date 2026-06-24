import SwiftUI
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
	let cookie: HTTPCookie
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
		// Scope the minted session cookie to this sheet: a non-persistent store
		// keeps it off disk so it never outlives the reader or survives a sign-out
		// (the default store is process-wide and on-disk).
		configuration.websiteDataStore = .nonPersistent()

		let webView = WKWebView(frame: .zero, configuration: configuration)
		webView.customUserAgent = AppConfig.webViewUserAgent
		webView.allowsBackForwardNavigationGestures = true
		controller.view = webView

		// Inject the prefetched session cookie into the web view's own store before
		// the first navigation, so the reader and its in-reader XHRs are
		// authenticated from the first request.
		webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) {
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

/// The JS↔native bridge for the reader. The reader's mark-read control is an
/// htmx form whose XHR never triggers a navigation, so a `WKNavigationDelegate`
/// can't observe it — the script listens for htmx's swap event instead. The pure
/// message parser is unit-tested; the WKWebView glue that registers and receives
/// the message is left untested (OS boundary), like `AuthWebView` before it.
enum ReaderBridge {
	static let messageName = "readplaceReader"

	/// Cancels the htmx swap for a successful status-change POST (so the page it
	/// redirects to never flashes into the sheet) and signals the native side,
	/// which closes the sheet and drops the row. The detector keys on the protocol
	/// vocabulary — a successful POST carrying the `status` field — not on the
	/// request URL, so the server can move the endpoint without breaking the app.
	static let script = """
	(function () {
	  function hasStatusField(params) {
	    if (!params) { return false; }
	    if (typeof params.has === 'function') { return params.has('status'); }
	    if (typeof params.get === 'function') { return params.get('status') != null; }
	    return Object.prototype.hasOwnProperty.call(params, 'status');
	  }
	  function isStatusChange(detail) {
	    var cfg = (detail && detail.requestConfig) || {};
	    var verb = (cfg.verb || '').toString().toUpperCase();
	    var xhr = (detail && detail.xhr) || {};
	    return verb === 'POST' && hasStatusField(cfg.parameters) && xhr.status >= 200 && xhr.status < 400;
	  }
	  document.body.addEventListener('htmx:beforeSwap', function (event) {
	    if (!isStatusChange(event.detail)) { return; }
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
