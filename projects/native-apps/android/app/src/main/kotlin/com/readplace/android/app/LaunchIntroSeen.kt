package com.readplace.android.app

/**
 * The launch intro's persisted flags, standing in for the iOS `UserDefaults`. A
 * read answers null for a key never written, so each flag decides for itself how
 * an absent value reads. Production is SharedPreferences-backed; tests supply
 * their own.
 */
interface KeyValueFlags {
	fun getBoolean(key: String): Boolean?

	fun putBoolean(key: String, value: Boolean)
}

class LaunchIntroSeen(private val flags: KeyValueFlags) {
	fun claim(): Boolean {
		if (flags.getBoolean(SEEN_KEY) == true) return false
		flags.putBoolean(SEEN_KEY, true)
		return true
	}

	private companion object {
		const val SEEN_KEY = "launchIntro.seen"
	}
}
