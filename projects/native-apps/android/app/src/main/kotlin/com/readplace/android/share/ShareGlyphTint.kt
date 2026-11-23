package com.readplace.android.share

import androidx.compose.ui.graphics.Color
import com.readplace.android.app.BrandColors

fun shareGlyphTint(tone: ShareStatusTone, brand: BrandColors, isDark: Boolean): Color = when (tone) {
	ShareStatusTone.SUCCESS -> brand.success
	ShareStatusTone.WARNING -> if (isDark) brand.warning else Color(red = 159, green = 115, blue = 45)
	ShareStatusTone.ERROR -> brand.error
}
