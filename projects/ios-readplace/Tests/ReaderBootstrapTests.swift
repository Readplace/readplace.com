import Foundation
import XCTest

@testable import Readplace

final class ReaderBootstrapTests: XCTestCase {
	func testAMintedSessionIsReadyWithItsCookies() throws {
		let cookie = try XCTUnwrap(HTTPCookie(properties: [
			.name: "hutch_sid", .value: "sess-xyz", .domain: "readplace.com", .path: "/",
		]))

		XCTAssertEqual(ReaderBootstrap(after: .minted([cookie])), .ready([cookie]))
	}

	func testAFailedMintIsUnavailable() {
		XCTAssertEqual(ReaderBootstrap(after: .failed), .unavailable)
	}

	func testASupersededMintStaysLoadingSoTheNextAppearanceRetries() {
		XCTAssertEqual(
			ReaderBootstrap(after: .superseded), .loading,
			"a mint cancelled by an article switch must leave the bootstrap retryable, not \"Couldn't open the reader\""
		)
	}
}
