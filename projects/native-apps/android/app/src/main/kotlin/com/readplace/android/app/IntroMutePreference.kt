package com.readplace.android.app

class IntroMutePreference(private val flags: KeyValueFlags) {
	var isMuted: Boolean
		get() = flags.getBoolean(MUTED_KEY) == true
		set(value) {
			flags.putBoolean(MUTED_KEY, value)
		}

	private companion object {
		const val MUTED_KEY = "launchIntro.muted"
	}
}
