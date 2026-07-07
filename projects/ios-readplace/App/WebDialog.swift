import UIKit
import WebKit

/// The native dialog a page's JS dialog call maps to. WKWebView suppresses
/// `window.confirm()`/`window.alert()` unless the host implements
/// `WKUIDelegate` — and the account page's "Delete account" form is gated by
/// htmx's `hx-confirm`, which calls `window.confirm()`, so a suppressed dialog
/// silently answers false and the button does nothing in-app. Pure and
/// `Equatable` so the panel-kind → dialog mapping is unit-tested without a web
/// view, like `ReaderNavigation` before it; only `presentWebDialog` below is
/// untested UIKit glue.
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
	/// semantics. The affirmative choice renders destructive because the server
	/// uses `hx-confirm` to gate irreversible actions (the account page's
	/// delete): over-warning a benign confirm is safer than under-warning a
	/// destructive one, and the message itself is the page's to write.
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
