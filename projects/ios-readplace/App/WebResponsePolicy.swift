import Foundation

/// Whether the in-app web view should render a navigation response or treat it as
/// a failure. WKWebView delivers a 4xx/5xx through `didFinish`, not `didFail`, so
/// the web view would otherwise paint the server's error body. Deciding here in a
/// pure value keeps the "an error status fails" policy unit-testable and out of the
/// OS-boundary delegate, which keeps only the `decisionHandler` plumbing.
enum WebResponsePolicy: Equatable {
	case allow
	case fail

	static func decide(statusCode: Int?) -> WebResponsePolicy {
		if let statusCode, statusCode >= 400 { return .fail }
		return .allow
	}
}
