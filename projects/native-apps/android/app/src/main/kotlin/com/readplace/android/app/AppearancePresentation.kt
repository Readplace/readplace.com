package com.readplace.android.app

object AppearancePresentation {
	fun isDark(appearance: String?, systemInDarkTheme: Boolean): Boolean =
		when (appearance) {
			"light" -> false
			"dark" -> true
			else -> systemInDarkTheme
		}
}
