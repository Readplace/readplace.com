import UIKit

/// The native dialog a page's JS dialog call maps to. WKWebView suppresses
/// `window.confirm()`/`window.alert()` unless the host implements
/// `WKUIDelegate`, so a suppressed dialog silently answers false and whatever it
/// gated does nothing in-app — the app hosts the server's pages, so it must
/// answer the dialogs those pages raise. Pure and `Equatable` so the panel-kind →
/// dialog mapping is unit-tested without a web view, like `ReaderNavigation`
/// before it; the `UIAlertController` glue that presents it is `presentWebDialog`
/// in `ReaderWebView.swift` (OS boundary).
struct WebDialog: Equatable {
	/// One tappable choice, carrying the boolean it answers the page's
	/// `confirm()` with. An alert's single OK carries one too — the alert
	/// completion ignores it — so both dialog kinds flow through the one
	/// presentation path with a single answer contract.
	struct Choice: Equatable {
		let title: String
		let style: UIAlertAction.Style
		let answer: Bool
	}

	let message: String
	let choices: [Choice]
	/// The answer given when no dialog can be presented (the web view has no
	/// window). The page's script must never hang on an unanswered handler, and
	/// an unpresentable confirm must refuse — never affirm — the action it gates.
	let unpresentedAnswer: Bool

	/// `window.confirm()`: Cancel/OK, matching the browser's two-button
	/// semantics. The affirmative choice renders destructive because a page only
	/// reaches for a confirm to gate something it can't take back: over-warning a
	/// benign confirm is safer than under-warning a destructive one, and the
	/// message itself is the page's to write.
	static func confirm(message: String) -> WebDialog {
		WebDialog(
			message: message,
			choices: [
				Choice(title: "Cancel", style: .cancel, answer: false),
				Choice(title: "OK", style: .destructive, answer: true),
			],
			unpresentedAnswer: false
		)
	}

	/// `window.alert()`: a single OK that only acknowledges.
	static func alert(message: String) -> WebDialog {
		WebDialog(
			message: message,
			choices: [Choice(title: "OK", style: .default, answer: true)],
			unpresentedAnswer: true
		)
	}
}
