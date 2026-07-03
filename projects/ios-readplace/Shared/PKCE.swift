import CryptoKit
import Foundation

/// PKCE (RFC 7636) helpers. The server requires `code_challenge_method=S256`
/// and a `code_verifier` whose SHA-256 base64url-encodes to the challenge.
enum PKCE {
	/// A high-entropy verifier (43 characters, within the 43–128 RFC range).
	static func makeCodeVerifier() -> String {
		var bytes = [UInt8](repeating: 0, count: 32)
		let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
		// On RNG failure the buffer stays all-zero, which would make the verifier
		// and CSRF state constant and guessable — fail the build of a login rather
		// than proceed with a predictable secret.
		precondition(status == errSecSuccess, "SecRandomCopyBytes failed (\(status))")
		return base64URLEncode(Data(bytes))
	}

	/// `BASE64URL(SHA256(verifier))`.
	static func challenge(for verifier: String) -> String {
		let digest = SHA256.hash(data: Data(verifier.utf8))
		return base64URLEncode(Data(digest))
	}

	/// An opaque value for the OAuth `state` parameter (CSRF defence).
	static func makeState() -> String {
		makeCodeVerifier()
	}

	private static func base64URLEncode(_ data: Data) -> String {
		data.base64EncodedString()
			.replacingOccurrences(of: "+", with: "-")
			.replacingOccurrences(of: "/", with: "_")
			.replacingOccurrences(of: "=", with: "")
	}
}
