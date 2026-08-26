package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Test

class WebResponsePolicyTest {
	@Test
	fun `renders a successful response`() {
		assertEquals(WebResponsePolicy.ALLOW, WebResponsePolicy.decide(statusCode = 200))
	}

	@Test
	fun `renders a redirect the web view already followed`() {
		assertEquals(WebResponsePolicy.ALLOW, WebResponsePolicy.decide(statusCode = 302))
	}

	@Test
	fun `renders the last status below the error range`() {
		assertEquals(WebResponsePolicy.ALLOW, WebResponsePolicy.decide(statusCode = 399))
	}

	@Test
	fun `fails on the first client error rather than painting its body`() {
		assertEquals(WebResponsePolicy.FAIL, WebResponsePolicy.decide(statusCode = 400))
	}

	@Test
	fun `fails on a not found page`() {
		assertEquals(WebResponsePolicy.FAIL, WebResponsePolicy.decide(statusCode = 404))
	}

	@Test
	fun `fails on a server error`() {
		assertEquals(WebResponsePolicy.FAIL, WebResponsePolicy.decide(statusCode = 500))
	}

	@Test
	fun `renders a response that carries no status`() {
		assertEquals(WebResponsePolicy.ALLOW, WebResponsePolicy.decide(statusCode = null))
	}
}
