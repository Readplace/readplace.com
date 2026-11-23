package com.readplace.android.app

import androidx.compose.ui.graphics.Color

fun offlineBadgeInk(isDark: Boolean): Color =
	if (isDark) Color(red = 96, green = 181, blue = 149) else Color(red = 46, green = 106, blue = 85)
