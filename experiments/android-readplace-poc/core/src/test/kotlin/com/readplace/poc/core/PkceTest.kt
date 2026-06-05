package com.readplace.poc.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PkceTest {
	@Test
	fun `matches the RFC 7636 appendix B test vector`() {
		val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
		assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.challenge(verifier))
	}

	@Test
	fun `verifier is 43 url-safe characters`() {
		val verifier = Pkce.makeCodeVerifier()
		assertEquals(43, verifier.length)
		assertTrue(verifier.all { it.isLetterOrDigit() || it == '-' || it == '_' }, "verifier: $verifier")
	}

	@Test
	fun `challenge is base64url with no padding or unsafe characters`() {
		val challenge = Pkce.challenge(Pkce.makeCodeVerifier())
		assertFalse(challenge.contains('+'))
		assertFalse(challenge.contains('/'))
		assertFalse(challenge.contains('='))
	}

	@Test
	fun `successive verifiers are unique`() {
		assertNotEquals(Pkce.makeCodeVerifier(), Pkce.makeCodeVerifier())
	}
}
