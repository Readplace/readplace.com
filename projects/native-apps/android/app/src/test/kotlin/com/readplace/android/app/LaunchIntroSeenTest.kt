package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LaunchIntroSeenTest {
	private class EphemeralFlags : KeyValueFlags {
		val values = mutableMapOf<String, Boolean>()

		override fun getBoolean(key: String): Boolean? = values[key]

		override fun putBoolean(key: String, value: Boolean) {
			values[key] = value
		}
	}

	@Test
	fun `the first claim on a fresh install succeeds and records the seen flag`() {
		val flags = EphemeralFlags()

		assertTrue(LaunchIntroSeen(flags).claim())

		assertEquals(mapOf("launchIntro.seen" to true), flags.values)
	}

	@Test
	fun `a second claim fails`() {
		val seen = LaunchIntroSeen(EphemeralFlags())
		seen.claim()

		assertFalse(seen.claim())
	}

	@Test
	fun `the claim is remembered across instances sharing the store`() {
		val flags = EphemeralFlags()
		LaunchIntroSeen(flags).claim()

		assertFalse(LaunchIntroSeen(flags).claim())
		assertEquals(mapOf("launchIntro.seen" to true), flags.values)
	}

	@Test
	fun `a flag stored as false is still claimable`() {
		val flags = EphemeralFlags()
		flags.putBoolean("launchIntro.seen", false)

		assertTrue(LaunchIntroSeen(flags).claim())

		assertEquals(mapOf("launchIntro.seen" to true), flags.values)
	}
}
