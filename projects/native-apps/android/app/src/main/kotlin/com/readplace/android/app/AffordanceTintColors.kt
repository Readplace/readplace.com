package com.readplace.android.app

import androidx.compose.ui.graphics.Color

fun AffordanceTint.fill(colors: BrandColors): Color? =
	when (this) {
		AffordanceTint.NEUTRAL -> null
		AffordanceTint.SUCCESS -> colors.success
		AffordanceTint.DESTRUCTIVE -> colors.error
	}

fun AffordanceTint.ink(colors: BrandColors): Color? =
	when (this) {
		AffordanceTint.NEUTRAL -> null
		AffordanceTint.SUCCESS -> colors.successText
		AffordanceTint.DESTRUCTIVE -> colors.errorText
	}
