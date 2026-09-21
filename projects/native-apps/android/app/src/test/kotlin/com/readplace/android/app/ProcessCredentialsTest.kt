package com.readplace.android.app

import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class ProcessCredentialsTest {
	@Test
	fun `the app and its share target reach the one process-wide credentials`() {
		val app = RuntimeEnvironment.getApplication()

		val first = ProcessCredentials.of(app)
		val second = ProcessCredentials.of(app)

		assertSame("both composition roots share one coordinator", first, second)
		assertNull("a fresh install has no stored session", first.oauth.snapshot())
	}
}
