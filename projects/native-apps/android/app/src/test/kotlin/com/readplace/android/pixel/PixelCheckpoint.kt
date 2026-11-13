package com.readplace.android.pixel

import java.io.File

enum class Appearance(val tag: String) {
	Light("light"),
	Dark("dark"),
}

data class PixelCheckpoint(val suite: String, val name: String, val appearance: Appearance) {
	val relativePath: String get() = "$suite/$name-${appearance.tag}.png"
}

sealed interface CheckpointOutcome {
	data object Verified : CheckpointOutcome

	data object Flat : CheckpointOutcome

	data class Recorded(val file: File) : CheckpointOutcome

	data class MissingBaseline(val file: File) : CheckpointOutcome

	data class Mismatch(val verdict: PixelVerdict, val actualFile: File) : CheckpointOutcome
}

class PixelBaselines(
	private val baselineDir: File,
	private val failureDir: File,
	private val isRecording: Boolean,
	private val tolerance: PixelTolerance,
) {
	fun settle(checkpoint: PixelCheckpoint, capture: PixelBitmap): CheckpointOutcome {
		if (capture.argb.all { it == capture.argb[0] }) return CheckpointOutcome.Flat

		val baseline = File(baselineDir, checkpoint.relativePath)
		if (isRecording) {
			capture.encodePng(baseline)
			return CheckpointOutcome.Recorded(baseline)
		}
		if (!baseline.isFile) return CheckpointOutcome.MissingBaseline(baseline)

		val verdict = comparePixels(baseline = decodePng(baseline), capture = capture, tolerance = tolerance)
		if (verdict == PixelVerdict.Match) return CheckpointOutcome.Verified

		val actual = File(failureDir, checkpoint.relativePath)
		capture.encodePng(actual)
		return CheckpointOutcome.Mismatch(verdict = verdict, actualFile = actual)
	}
}
