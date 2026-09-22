package com.readplace.android.app

import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * The process composition root exposes ONE shared OAuth and token store: the app
 * and the share target run in the same process and must resolve the same credential
 * owner, or a single-flight refresh and the session generation would not be shared
 * across them. These assert the wiring constructs and hands back stable singletons;
 * the behavior of what it wires is tested through OAuth/ReadplaceApi/AppSession.
 */
@RunWith(RobolectricTestRunner::class)
class ReadplaceAppTest {
	private val app: ReadplaceApp get() = RuntimeEnvironment.getApplication() as ReadplaceApp

	@Test
	fun `the shared oauth and token store are process-wide singletons`() {
		val app = this.app
		assertSame("every consumer must resolve the one OAuth owner", app.oauth, app.oauth)
		assertSame("and the one token store behind it", app.tokenStore, app.tokenStore)
	}

	@Test
	fun `the native user agent names the build`() {
		assertTrue(app.nativeUserAgent.startsWith("Readplace/"))
	}
}
