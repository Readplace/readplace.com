package com.readplace.android.app

import androidx.compose.ui.graphics.Color

fun AffordanceTint.trayFill(): Color? =
	when (this) {
		AffordanceTint.NEUTRAL -> null
		AffordanceTint.SUCCESS -> Color(red = 54, green = 124, blue = 99)
		AffordanceTint.DESTRUCTIVE -> Color(red = 185, green = 80, blue = 80)
	}
