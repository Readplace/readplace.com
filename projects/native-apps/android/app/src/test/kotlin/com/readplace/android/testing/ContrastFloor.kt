package com.readplace.android.testing

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertTrue
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

fun assertClears(ink: Color, ground: Color, floor: Double, label: String) {
	val colour = ratio(ink = luminance(ink), ground = luminance(ground))
	val greyscale = ratio(ink = greyLuminance(ink), ground = greyLuminance(ground))
	assertTrue("$label colour=$colour", colour >= floor)
	assertTrue("$label greyscale=$greyscale", greyscale >= floor)
}

private fun ratio(ink: Double, ground: Double): Double = (max(ink, ground) + 0.05) / (min(ink, ground) + 0.05)

private fun luminance(color: Color): Double =
	0.2126 * linearise(color.red.toDouble()) + 0.7152 * linearise(color.green.toDouble()) + 0.0722 * linearise(color.blue.toDouble())

private fun greyLuminance(color: Color): Double =
	linearise(0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue)

private fun linearise(srgb: Double): Double =
	if (srgb <= 0.04045) srgb / 12.92 else ((srgb + 0.055) / 1.055).pow(2.4)
