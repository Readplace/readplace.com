package com.readplace.android.app

import android.content.Context
import android.view.ContextThemeWrapper
import com.readplace.android.R

fun webContentContext(context: Context, isDark: Boolean): Context =
	ContextThemeWrapper(
		context,
		if (isDark) R.style.Theme_Readplace_WebContent_Dark else R.style.Theme_Readplace_WebContent_Light,
	)
