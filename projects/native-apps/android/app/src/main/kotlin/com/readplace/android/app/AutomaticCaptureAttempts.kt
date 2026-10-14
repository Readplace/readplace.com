package com.readplace.android.app

class AutomaticCaptureAttempts(private val flags: KeyValueFlags) {
	fun claim(articleId: String): Boolean {
		val key = attemptedKey(articleId)
		if (flags.getBoolean(key) == true) return false
		flags.putBoolean(key, true)
		return true
	}

	private companion object {
		fun attemptedKey(articleId: String): String = "automaticCapture.attempted.$articleId"
	}
}
