package com.readplace.poc.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AuthRedirectTest {
	private val request = AuthorizationRequest(
		url = "https://readplace.com/oauth/authorize?client_id=x",
		redirectUri = "https://readplace.com/oauth/callback",
		codeVerifier = "verifier",
		state = "expected-state",
	)

	@Test
	fun `grants when the callback carries a code and the matching state`() {
		val result = AuthRedirect.from(
			"https://readplace.com/oauth/callback?code=the-code&state=expected-state",
			request,
		)
		assertEquals(AuthRedirect.Granted("the-code"), result)
	}

	@Test
	fun `fails when the user denied consent`() {
		val result = AuthRedirect.from(
			"https://readplace.com/oauth/callback?error=access_denied&state=expected-state",
			request,
		)
		assertTrue(result is AuthRedirect.Failed)
		assertTrue((result as AuthRedirect.Failed).message.contains("access_denied"))
	}

	@Test
	fun `fails on a state mismatch`() {
		val result = AuthRedirect.from(
			"https://readplace.com/oauth/callback?code=the-code&state=tampered",
			request,
		)
		assertTrue(result is AuthRedirect.Failed)
	}

	@Test
	fun `stays pending on navigations that are not the callback`() {
		assertNull(AuthRedirect.from("https://readplace.com/oauth/authorize?client_id=x", request))
		assertNull(AuthRedirect.from("https://accounts.google.com/signin", request))
	}

	@Test
	fun `stays pending on the bare callback without a result`() {
		assertNull(AuthRedirect.from("https://readplace.com/oauth/callback", request))
		assertNull(AuthRedirect.from("https://readplace.com/oauth/callback?state=expected-state", request))
	}

	@Test
	fun `decodes percent-encoded parameters`() {
		val result = AuthRedirect.from(
			"https://readplace.com/oauth/callback?code=a%2Bb&state=expected-state",
			request,
		)
		assertEquals(AuthRedirect.Granted("a+b"), result)
	}

	@Test
	fun `ignores a fragment after the query`() {
		val result = AuthRedirect.from(
			"https://readplace.com/oauth/callback?code=c1&state=expected-state#section",
			request,
		)
		assertEquals(AuthRedirect.Granted("c1"), result)
	}
}
