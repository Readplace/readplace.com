import XCTest
@testable import Readplace

final class PKCETests: XCTestCase {
	/// RFC 7636, Appendix B — the canonical verifier→challenge vector.
	func testChallengeMatchesRFC7636Vector() {
		let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
		XCTAssertEqual(PKCE.challenge(for: verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
	}

	func testVerifierIsBase64URLAndCorrectLength() {
		let verifier = PKCE.makeCodeVerifier()
		XCTAssertEqual(verifier.count, 43, "32 random bytes base64url-encode to 43 chars (RFC range 43–128)")
		let allowed = CharacterSet(charactersIn:
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
		XCTAssertTrue(verifier.unicodeScalars.allSatisfy(allowed.contains))
		XCTAssertFalse(verifier.contains("="))
		XCTAssertFalse(verifier.contains("+"))
		XCTAssertFalse(verifier.contains("/"))
	}

	func testVerifiersAreUnique() {
		XCTAssertNotEqual(PKCE.makeCodeVerifier(), PKCE.makeCodeVerifier())
	}

	func testChallengeIsBase64URLAndCorrectLength() {
		let challenge = PKCE.challenge(for: PKCE.makeCodeVerifier())
		XCTAssertEqual(challenge.count, 43, "a SHA-256 digest base64url-encodes to 43 chars")
		let allowed = CharacterSet(charactersIn:
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
		XCTAssertTrue(
			challenge.unicodeScalars.allSatisfy(allowed.contains),
			"every character is in the base64url alphabet (no +, /, or =)"
		)
	}
}
