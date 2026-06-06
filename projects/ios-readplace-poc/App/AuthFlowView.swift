import SwiftUI
import WebKit

enum AuthFlowError: LocalizedError {
	case denied(String)
	case missingCode
	case stateMismatch

	var errorDescription: String? {
		switch self {
		case .denied(let reason): return "Authorization was denied (\(reason))."
		case .missingCode: return "No authorization code was returned."
		case .stateMismatch: return "Security check failed (state mismatch)."
		}
	}
}

/// Presents the server's `/oauth/authorize` page in a WKWebView, intercepts the
/// redirect back to the registered callback URL, then exchanges the code for
/// tokens — the native equivalent of the extension opening a tab and waiting
/// for the redirect.
struct AuthFlowView: View {
	@EnvironmentObject private var session: AppSession
	@Environment(\.dismiss) private var dismiss

	let onComplete: (Result<Void, Error>) -> Void

	@State private var request: AuthorizationRequest?
	@State private var exchanging = false

	var body: some View {
		NavigationStack {
			ZStack {
				if let request {
					AuthWebView(authorizeURL: request.url, redirectURI: request.redirectURI) { callbackURL in
						handleCallback(callbackURL, verifier: request.codeVerifier, expectedState: request.state)
					}
					.ignoresSafeArea(edges: .bottom)
				} else {
					ProgressView()
				}

				if exchanging {
					Color(.systemBackground).opacity(0.85).ignoresSafeArea()
					ProgressView("Signing in…")
				}
			}
			.navigationTitle("Sign in")
			.navigationBarTitleDisplayMode(.inline)
			.toolbar {
				ToolbarItem(placement: .cancellationAction) {
					Button("Cancel") { dismiss() }
				}
			}
		}
		.onAppear {
			if request == nil { request = session.makeOAuth().makeAuthorizationRequest() }
		}
	}

	private func handleCallback(_ url: URL, verifier: String, expectedState: String) {
		guard !exchanging else { return }
		exchanging = true
		Task {
			let result = await session.completeSignIn(callbackURL: url, verifier: verifier, expectedState: expectedState)
			finish(result)
		}
	}

	private func finish(_ result: Result<Void, Error>) {
		onComplete(result)
		dismiss()
	}
}

/// A WKWebView that runs the authorization page and reports the callback URL
/// once the server redirects to `redirectURI` with a `code` (or `error`).
struct AuthWebView: UIViewControllerRepresentable {
	let authorizeURL: URL
	let redirectURI: String
	let onCallback: (URL) -> Void

	func makeCoordinator() -> Coordinator {
		Coordinator(redirectURI: redirectURI, onCallback: onCallback)
	}

	func makeUIViewController(context: Context) -> UIViewController {
		let controller = UIViewController()
		let webView = WKWebView(frame: .zero)
		webView.navigationDelegate = context.coordinator
		webView.customUserAgent = AppConfig.webViewUserAgent
		webView.allowsBackForwardNavigationGestures = true
		controller.view = webView
		webView.load(URLRequest(url: authorizeURL))
		return controller
	}

	func updateUIViewController(_ controller: UIViewController, context: Context) {}

	final class Coordinator: NSObject, WKNavigationDelegate {
		private let redirectURI: String
		private let onCallback: (URL) -> Void
		private var handled = false

		init(redirectURI: String, onCallback: @escaping (URL) -> Void) {
			self.redirectURI = redirectURI
			self.onCallback = onCallback
		}

		/// Reports the callback exactly once, when the URL is the redirect URI
		/// carrying a `code` or `error` query parameter.
		@discardableResult
		private func intercept(_ url: URL?) -> Bool {
			guard !handled, let url, url.absoluteString.hasPrefix(redirectURI) else { return false }
			let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
			let hasResult = items.contains { $0.name == "code" || $0.name == "error" }
			guard hasResult else { return false }
			handled = true
			onCallback(url)
			return true
		}

		func webView(
			_ webView: WKWebView,
			decidePolicyFor navigationAction: WKNavigationAction,
			decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
		) {
			if intercept(navigationAction.request.url) {
				decisionHandler(.cancel)
			} else {
				decisionHandler(.allow)
			}
		}

		func webView(_ webView: WKWebView, didReceiveServerRedirectForProvisionalNavigation navigation: WKNavigation!) {
			intercept(webView.url)
		}

		func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
			intercept(webView.url)
		}
	}
}
