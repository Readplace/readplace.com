package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Test

class ReaderRequestTest {
	@Test
	fun `a relative read href resolves against the base and carries the platform marker`() {
		val url = ReaderRequest.url(readHref = "/queue/a1/view?readlist=work", baseUrl = "https://readplace.test")

		assertEquals("https://readplace.test/queue/a1/view?readlist=work&platform=android", url)
	}

	@Test
	fun `a read href the client cannot resolve has no reader URL`() {
		val url = ReaderRequest.url(readHref = "javascript:alert(1)", baseUrl = "https://readplace.test")

		assertEquals(null, url)
	}
}
