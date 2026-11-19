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
			ERROR -> colors.error
			WARNING -> colors.warning
		}

	fun ink(colors: BrandColors): Color = if (this == OFFLINE) colors.textPrimary else Color.White

	companion object {
		fun ofError(errorText: String): BannerTone = if (errorText == OfflineReading.BANNER_TEXT) OFFLINE else ERROR
	}
}
