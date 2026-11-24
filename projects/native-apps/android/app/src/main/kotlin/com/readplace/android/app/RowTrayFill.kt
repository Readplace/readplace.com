package com.readplace.android.app

import androidx.compose.ui.graphics.Color

internal val ERROR_FILL = Color(red = 185, green = 80, blue = 80)

fun AffordanceTint.trayFill(): Color? =
	when (this) {
		AffordanceTint.NEUTRAL -> null
		AffordanceTint.SUCCESS -> Color(red = 54, green = 124, blue = 99)
		AffordanceTint.DESTRUCTIVE -> ERROR_FILL
	}
