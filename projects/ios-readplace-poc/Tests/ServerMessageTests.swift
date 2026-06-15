import XCTest
@testable import Readplace

final class ServerMessageTests: XCTestCase {
	private func message(type: String = "warning", body: String) -> ServerMessage {
		ServerMessage(type: type, content: ServerMessage.Content(type: "text/html", body: body))
	}

	// MARK: plainText — strips markup, then decodes entities in a single pass

	func testStripsTagsAndTrimsSurroundingWhitespace() {
		let message = message(body: "  <p>Email <a href=\"mailto:a@b.com\">a@b.com</a> now</p>  ")
		XCTAssertEqual(message.plainText, "Email a@b.com now")
	}

	func testDecodesNamedReferences() {
		let message = message(body: "Tom &amp; Jerry said &quot;hi&quot; &lt;here&gt; it&#39;s fine")
		XCTAssertEqual(message.plainText, "Tom & Jerry said \"hi\" <here> it's fine")
	}

	func testDecodesDecimalAndHexReferences() {
		let message = message(body: "&#39;quoted&#39; and &#x27;hex&#x27; and &#38;")
		XCTAssertEqual(message.plainText, "'quoted' and 'hex' and &")
	}

	/// The reason for a single-pass decoder: a correctly-escaped `&amp;lt;` must
	/// decode once to the literal text `&lt;`, not twice to `<`. The old chained
	/// `replacingOccurrences` resolved `&amp;` first and then re-read the `&lt;`.
	func testDoesNotDoubleDecode() {
		let message = message(body: "literal &amp;lt; entity")
		XCTAssertEqual(message.plainText, "literal &lt; entity")
	}

	func testLeavesBareAmpersandAndUnresolvableReferencesVerbatim() {
		let message = message(body: "fish & chips, &unknown; &#zz; &notclosed")
		XCTAssertEqual(message.plainText, "fish & chips, &unknown; &#zz; &notclosed")
	}

	// MARK: kind — presentation mapping with a forward-compatible fallback

	func testKindMapsErrorType() {
		XCTAssertEqual(message(type: "error", body: "x").kind, .error)
	}

	func testKindMapsWarningType() {
		XCTAssertEqual(message(type: "warning", body: "x").kind, .warning)
	}

	func testKindFallsBackToWarningForUnknownType() {
		XCTAssertEqual(message(type: "future-severity", body: "x").kind, .warning)
	}
}
