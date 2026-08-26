package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

private const val BASE64URL_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

private fun outsideBase64Url(value: String): String = value.filterNot { it in BASE64URL_ALPHABET }

class PkceTest {
	@Test
	fun `a verifier is 32 random bytes encoded to 43 characters, inside the RFC 7636 43 to 128 range`() {
		assertEquals(43, Pkce.makeCodeVerifier().length)
	}

	@Test
	fun `a verifier carries no character outside the base64url alphabet`() {
		assertEquals("", outsideBase64Url(Pkce.makeCodeVerifier()))
	}

	@Test
	fun `a verifier carries none of the characters base64url replaces or drops`() {
		val verifier = Pkce.makeCodeVerifier()

		assertEquals("", verifier.filter { it == '+' || it == '/' || it == '=' })
	}

	@Test
	fun `two verifiers differ`() {
		assertNotEquals(Pkce.makeCodeVerifier(), Pkce.makeCodeVerifier())
	}

	@Test
	fun `challengeFor produces the RFC 7636 appendix B challenge for its verifier`() {
		assertEquals(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
			Pkce.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
		)
	}

	@Test
	fun `challengeFor base64url encodes the SHA-256 of abc, replacing the plus and slash a standard encoder emits`() {
		assertEquals("ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0", Pkce.challengeFor("abc"))
	}

	@Test
	fun `challengeFor hashes an empty verifier rather than answering empty`() {
		assertEquals("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU", Pkce.challengeFor(""))
	}

	@Test
	fun `challengeFor hashes the verifier's UTF-8 bytes`() {
		assertEquals("YurGKHWkB1KpZ_d0_DTR0sXTJAGmB7WR0Ucr7drYh8Q", Pkce.challengeFor("Ä-ünïcødé"))
	}

	@Test
	fun `challengeFor answers the same challenge for the same verifier`() {
		val verifier = Pkce.makeCodeVerifier()

		assertEquals(Pkce.challengeFor(verifier), Pkce.challengeFor(verifier))
	}

	@Test
	fun `a challenge for a generated verifier is a 43 character unpadded base64url digest`() {
		val challenge = Pkce.challengeFor(Pkce.makeCodeVerifier())

		assertEquals(43, challenge.length)
		assertEquals("", outsideBase64Url(challenge))
	}

	@Test
	fun `a state is 43 characters of base64url, exactly like a verifier`() {
		val state = Pkce.makeState()

		assertEquals(43, state.length)
		assertEquals("", outsideBase64Url(state))
	}

	@Test
	fun `two states differ`() {
		assertNotEquals(Pkce.makeState(), Pkce.makeState())
	}

	@Test
	fun `a state is drawn separately from a verifier`() {
		assertNotEquals(Pkce.makeState(), Pkce.makeCodeVerifier())
	}
}
