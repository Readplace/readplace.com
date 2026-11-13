package com.readplace.android.pixel

import kotlin.math.ceil
import kotlin.math.sqrt

data class PixelTolerance(val threshold: Double, val maxDiffPixelRatio: Double)

val PIXEL_TOLERANCE = PixelTolerance(threshold = 0.02, maxDiffPixelRatio = 0.0005)

sealed interface PixelVerdict {
	data object Match : PixelVerdict

	data class SizeMismatch(
		val expectedWidth: Int,
		val expectedHeight: Int,
		val actualWidth: Int,
		val actualHeight: Int,
	) : PixelVerdict

	data class TooManyDiffering(
		val differing: Int,
		val total: Int,
		val smallestPassingThreshold: Double,
	) : PixelVerdict
}

private const val MAXIMUM_YIQ_DELTA = 35215.0

fun comparePixels(baseline: PixelBitmap, capture: PixelBitmap, tolerance: PixelTolerance): PixelVerdict {
	if (baseline.width != capture.width || baseline.height != capture.height) {
		return PixelVerdict.SizeMismatch(
			expectedWidth = baseline.width,
			expectedHeight = baseline.height,
			actualWidth = capture.width,
			actualHeight = capture.height,
		)
	}

	val budget = MAXIMUM_YIQ_DELTA * tolerance.threshold * tolerance.threshold
	val deltas = DoubleArray(baseline.argb.size) { colorDelta(baseline.argb[it], capture.argb[it]) }
	val total = deltas.size
	val differing = deltas.count { it > budget }
	if (differing.toDouble() / total <= tolerance.maxDiffPixelRatio) return PixelVerdict.Match

	val allowed = (tolerance.maxDiffPixelRatio * total).toInt()
	val deciding = deltas.sortedDescending()[allowed]
	return PixelVerdict.TooManyDiffering(
		differing = differing,
		total = total,
		smallestPassingThreshold = ceil(sqrt(deciding / MAXIMUM_YIQ_DELTA) * 10_000) / 10_000,
	)
}

private fun colorDelta(lhs: Int, rhs: Int): Double {
	val r1 = red(lhs)
	val g1 = green(lhs)
	val b1 = blue(lhs)
	val r2 = red(rhs)
	val g2 = green(rhs)
	val b2 = blue(rhs)

	val y = rgb2y(r1, g1, b1) - rgb2y(r2, g2, b2)
	val i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2)
	val q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2)

	return 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q
}

private fun red(argb: Int): Double = ((argb shr 16) and 0xFF).toDouble()

private fun green(argb: Int): Double = ((argb shr 8) and 0xFF).toDouble()

private fun blue(argb: Int): Double = (argb and 0xFF).toDouble()

private fun rgb2y(r: Double, g: Double, b: Double): Double = r * 0.29889531 + g * 0.58662247 + b * 0.11448223

private fun rgb2i(r: Double, g: Double, b: Double): Double = r * 0.59597799 - g * 0.27417610 - b * 0.32180189

private fun rgb2q(r: Double, g: Double, b: Double): Double = r * 0.21147017 - g * 0.52261711 + b * 0.31114694
