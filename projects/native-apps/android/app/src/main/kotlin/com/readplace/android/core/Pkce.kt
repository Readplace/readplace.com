package com.readplace.android.core

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * PKCE (RFC 7636) helpers. The server requires `code_challenge_method=S256` and a
 * `code_verifier` whose SHA-256 base64url-encodes to the challenge.
 */
object Pkce {
	private val random = SecureRandom()
	private val encoder: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()

	/** A high-entropy verifier (43 characters, within the 43–128 RFC range). */
	fun makeCodeVerifier(): String {
		val bytes = ByteArray(32)
		random.nextBytes(bytes)
		return encoder.encodeToString(bytes)
	}

	/** `BASE64URL(SHA256(verifier))`. */
	fun challengeFor(verifier: String): String {
		val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.UTF_8))
		return encoder.encodeToString(digest)
	}

	/** An opaque value for the OAuth `state` parameter (CSRF defence). */
	fun makeState(): String = makeCodeVerifier()
}
