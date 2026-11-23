package com.readplace.android.app

import androidx.compose.ui.graphics.Color
import com.readplace.android.core.OfflineReading

enum class BannerTone {
	OFFLINE,
	ERROR,
	WARNING,
	;

	fun fill(colors: BrandColors): Color =
		when (this) {
			OFFLINE -> colors.secondary
			ERROR -> Color(red = 185, green = 80, blue = 80)
			WARNING -> colors.secondary
		}

	fun ink(colors: BrandColors): Color = if (this == ERROR) Color.White else colors.textPrimary

	fun backdrop(colors: BrandColors): Color = if (this == ERROR) Color.Transparent else colors.surface

	companion object {
		fun ofError(errorText: String): BannerTone = if (errorText == OfflineReading.BANNER_TEXT) OFFLINE else ERROR
	}
}
