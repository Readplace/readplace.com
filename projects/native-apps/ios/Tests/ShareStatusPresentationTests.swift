import Security
import XCTest
@testable import Readplace

final class ShareStatusPresentationTests: XCTestCase {
	private func present(_ outcome: SaveSharedOutcome) -> ShareStatusPresentation {
		ShareStatusPresentation(outcome: outcome)
	}

	private func message(type: String, body: String = "x") -> ServerMessage {
		ServerMessage(type: type, content: ServerMessage.Content(type: "text/html", body: body))
	}

	func testSavedIsSuccess() {
		// The no-queue outcome: there is no content waiting on the app, so the card
		// has nothing to add under the title.
		let status = present(.saved([]))
		XCTAssertEqual(status.message, "Saved")
		XCTAssertNil(status.subtitle)
		XCTAssertEqual(status.symbol, "checkmark.circle.fill")
		XCTAssertEqual(status.tone, .success)
	}

	func testSavedSpeaksTheServersConfirmationWhenItSentOne() {
		let status = present(.saved([
			message(type: "success", body: "Article saved"),
			message(type: "success", body: "Saved to your reading list"),
		]))
		XCTAssertEqual(status.message, "Article saved\nSaved to your reading list")
		XCTAssertNil(status.subtitle)
		XCTAssertEqual(status.tone, .success)
	}

	func testSavedAwaitingUploadSaysWhoWillCarryTheContent() {
		let status = present(.savedAwaitingUpload([]))
		XCTAssertEqual(status.message, "Saved url")
		XCTAssertEqual(status.subtitle, "Content will be uploaded when you open the Readplace app")
		XCTAssertEqual(status.symbol, "checkmark.circle.fill")
		XCTAssertEqual(status.tone, .success)
	}

	func testSavedAwaitingUploadKeepsTheServersConfirmationAsItsTitle() {
		let status = present(.savedAwaitingUpload([
			message(type: "success", body: "Article saved"),
			message(type: "success", body: "Saved to your reading list"),
		]))
		XCTAssertEqual(status.message, "Article saved\nSaved to your reading list")
		XCTAssertEqual(status.subtitle, "Content will be uploaded when you open the Readplace app")
	}

	func testSavedConfirmationIsShownAsTextNeverMarkup() {
		let status = present(.saved([
			message(type: "success", body: "<strong>Article</strong> saved"),
		]))
		XCTAssertEqual(status.message, "Article saved")
	}

	func testNotLoggedInIsWarning() {
		let status = present(.notLoggedIn)
		XCTAssertEqual(status.message, "Open Readplace and sign in first.")
		XCTAssertNil(status.subtitle)
		XCTAssertEqual(status.symbol, "person.crop.circle.badge.exclamationmark")
		XCTAssertEqual(status.tone, .warning)
	}

	func testStorageUnavailableIsErrorAndNamesTheStatus() {
		let status = present(.storageUnavailable(errSecMissingEntitlement))
		XCTAssertTrue(
			status.message.contains("\(errSecMissingEntitlement)"),
			"the message must name the OSStatus so the user can report it"
		)
		XCTAssertNil(status.subtitle)
		XCTAssertEqual(status.symbol, "exclamationmark.triangle.fill")
		XCTAssertEqual(status.tone, .error)
	}

	func testNoLinkIsWarning() {
		let status = present(.noLink)
		XCTAssertEqual(status.message, "No link found to save.")
		XCTAssertNil(status.subtitle)
		XCTAssertEqual(status.symbol, "link")
		XCTAssertEqual(status.tone, .warning)
	}

	func testNoSaveActionIsError() {
		let status = present(.noSaveAction)
		XCTAssertEqual(status.message, "The server offered no save action.")
		XCTAssertNil(status.subtitle)
		XCTAssertEqual(status.tone, .error)
	}

	func testRefusedJoinsMessagesAndIsWarningWhenNoneAreErrors() {
		let status = present(.refused([message(type: "warning", body: "one"), message(type: "warning", body: "two")]))
		XCTAssertEqual(status.message, "one\ntwo")
		XCTAssertNil(status.subtitle)
		XCTAssertEqual(status.symbol, "lock.fill")
		XCTAssertEqual(status.tone, .warning)
	}

	func testRefusedIsErrorWhenAnyMessageIsAnError() {
		let status = present(.refused([message(type: "warning"), message(type: "error")]))
		XCTAssertEqual(status.tone, .error)
	}

	func testFailedCarriesTheServerMessageAsError() {
		let status = present(.failed("Something broke"))
		XCTAssertEqual(status.message, "Something broke")
		XCTAssertNil(status.subtitle)
		XCTAssertEqual(status.symbol, "exclamationmark.triangle.fill")
		XCTAssertEqual(status.tone, .error)
	}
}
