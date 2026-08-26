package com.readplace.android.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class IntroMutePreferenceTest {
	private class EphemeralFlags : KeyValueFlags {
		val values = mutableMapOf<String, Boolean>()

		override fun getBoolean(key: String): Boolean? = values[key]

		override fun putBoolean(key: String, value: Boolean) {
			values[key] = value
		}
	}

	@Test
	fun `an unset preference reads as not muted`() {
		assertFalse(IntroMutePreference(EphemeralFlags()).isMuted)
	}

	@Test
	fun `muting is remembered under the launch intro muted key`() {
		val flags = EphemeralFlags()
		val preference = IntroMutePreference(flags)

		preference.isMuted = true

		assertTrue(preference.isMuted)
		assertEquals(mapOf("launchIntro.muted" to true), flags.values)
	}

	@Test
	fun `unmuting is remembered`() {
		val flags = EphemeralFlags()
		val preference = IntroMutePreference(flags)
		preference.isMuted = true

		preference.isMuted = false

		assertFalse(preference.isMuted)
		assertEquals(mapOf("launchIntro.muted" to false), flags.values)
	}

	@Test
	fun `the preference is read from the store, not cached, so another instance sees it`() {
		val flags = EphemeralFlags()
		IntroMutePreference(flags).isMuted = true

		assertTrue(IntroMutePreference(flags).isMuted)
	}
}
