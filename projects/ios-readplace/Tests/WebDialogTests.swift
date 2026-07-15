import UIKit
import XCTest
@testable import Readplace

/// The panel-kind → native-dialog mapping is pure: each JS dialog kind carries
/// the exact choices the UIAlertController glue renders verbatim, plus the
/// answer an unpresentable dialog (a web view with no window) must give — the
/// page's script must never hang on an unanswered completion handler.
final class WebDialogTests: XCTestCase {
	func testConfirmMapsToACancelAndADestructiveOK() {
		// window.confirm() keeps the browser's two-button semantics; the affirmative
		// choice is destructive-styled because a page only reaches for a confirm to
		// gate something it can't take back.
		let dialog = WebDialog.confirm(message: "Delete your account? This cannot be undone.")
		XCTAssertEqual(dialog.message, "Delete your account? This cannot be undone.")
		XCTAssertEqual(dialog.choices, [
			WebDialog.Choice(title: "Cancel", style: .cancel, answer: false),
			WebDialog.Choice(title: "OK", style: .destructive, answer: true),
		])
	}

	func testAnUnpresentableConfirmRefusesTheActionItGates() {
		XCTAssertFalse(
			WebDialog.confirm(message: "Delete?").unpresentedAnswer,
			"a confirm that cannot be shown must refuse — never affirm — the destructive action it gates"
		)
	}

	func testAlertMapsToASingleAcknowledgingOK() {
		let dialog = WebDialog.alert(message: "Saved.")
		XCTAssertEqual(dialog.message, "Saved.")
		XCTAssertEqual(dialog.choices, [WebDialog.Choice(title: "OK", style: .default, answer: true)])
		XCTAssertTrue(
			dialog.unpresentedAnswer,
			"an alert only acknowledges, so its unpresented answer completes without refusing anything"
		)
	}
}
