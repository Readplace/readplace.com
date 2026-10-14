package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutomaticCaptureAttemptsTest {
	private class EphemeralFlags : KeyValueFlags {
		val values = mutableMapOf<String, Boolean>()

		override fun getBoolean(key: String): Boolean? = values[key]

		override fun putBoolean(key: String, value: Boolean) {
			values[key] = value
		}
	}

	@Test
	fun `an article is claimed for an automatic capture only once`() {
		val attempts = AutomaticCaptureAttempts(EphemeralFlags())

		assertTrue(attempts.claim("a1"))
		assertFalse(
			"a failed article is rescued automatically once per device; after that only a tap retries it",
			attempts.claim("a1"),
		)
	}

	@Test
	fun `each article has its own attempt`() {
		val attempts = AutomaticCaptureAttempts(EphemeralFlags())
		attempts.claim("a1")

		assertTrue(
			"spending one article's attempt leaves every other article's untouched",
			attempts.claim("a2"),
		)
	}

	@Test
	fun `a claim is remembered by the device, not the instance`() {
		val flags = EphemeralFlags()
		assertTrue(AutomaticCaptureAttempts(flags).claim("a1"))

		assertFalse(
			"a relaunch builds a new instance over the same flags, and must not grant the article a fresh attempt",
			AutomaticCaptureAttempts(flags).claim("a1"),
		)
		assertEquals(mapOf("automaticCapture.attempted.a1" to true), flags.values)
	}

	@Test
	fun `an attempt stored as false is still claimable`() {
		val flags = EphemeralFlags()
		flags.putBoolean("automaticCapture.attempted.a1", false)

		assertTrue(AutomaticCaptureAttempts(flags).claim("a1"))
	}
}
