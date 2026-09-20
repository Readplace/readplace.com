package com.readplace.android.app

enum class SystemBarSurface {
	LAUNCH_INTRO,
	LOGIN,
	READING_LIST_LIGHT,
	READING_LIST_DARK,
}

object AppearancePresentation {
	fun isDark(appearance: String?, systemInDarkTheme: Boolean): Boolean =
		when (appearance) {
			"light" -> false
			"dark" -> true
			else -> systemInDarkTheme
		}

	/** Icon contrast follows the on-screen surface, not the OS
	 * light/dark setting that edge-to-edge's SystemBarStyle.auto
	 * keys off: the intro is always dark and the login screen
	 * always light regardless of it. */
	fun systemBarsNeedLightIcons(surface: SystemBarSurface): Boolean =
		when (surface) {
			SystemBarSurface.LAUNCH_INTRO, SystemBarSurface.READING_LIST_DARK -> true
			SystemBarSurface.LOGIN, SystemBarSurface.READING_LIST_LIGHT -> false
		}
}
