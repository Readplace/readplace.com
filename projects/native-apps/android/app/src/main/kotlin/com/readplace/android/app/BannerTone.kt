package com.readplace.android.app

import com.readplace.android.core.OfflineReading

enum class BannerTone {
	OFFLINE,
	ERROR,
	WARNING,
	;

	companion object {
		fun ofError(errorText: String): BannerTone = if (errorText == OfflineReading.BANNER_TEXT) OFFLINE else ERROR
	}
}
