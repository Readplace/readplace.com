package com.readplace.android.core

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerEndpointsTest {
	private val endpoints = ServerEndpoints("https://readplace.com")

	@Test fun `every bootstrap URL is the origin plus its server path`() {
		assertEquals("https://readplace.com", endpoints.origin)
		assertEquals("https://readplace.com/oauth/authorize", endpoints.authorize)
		assertEquals("https://readplace.com/oauth/token", endpoints.token)
		assertEquals("https://readplace.com/oauth/revoke", endpoints.revoke)
		assertEquals("https://readplace.com/.well-known/oauth-authorization-server", endpoints.authorizationServerMetadata)
		assertEquals("https://readplace.com/diagnostics/auth", endpoints.authDiagnostics)
	}
}
