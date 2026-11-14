package com.readplace.android.pixel

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import com.readplace.android.app.LocalBrandColors
import com.readplace.android.app.ReadplaceTheme
import org.junit.Assert.fail
import java.io.File
import kotlin.math.roundToInt

const val PIXEL_DEVICE = "w360dp-h640dp-mdpi"

private const val LEAF_TAG = "pixel-leaf"

fun AndroidComposeTestRule<*, ComponentActivity>.captureLeaf(
	appearance: Appearance,
	leaf: @Composable () -> Unit,
): PixelBitmap {
	setContent {
		ReadplaceTheme(darkTheme = appearance == Appearance.Dark) {
			Box(Modifier.width(360.dp).background(LocalBrandColors.current.surface).testTag(LEAF_TAG)) { leaf() }
		}
	}
	waitForIdle()
	val bounds = onNodeWithTag(LEAF_TAG).fetchSemanticsNode().boundsInRoot
	val content = activity.findViewById<View>(android.R.id.content)
	val window = Bitmap.createBitmap(content.width, content.height, Bitmap.Config.ARGB_8888)
	content.draw(Canvas(window))
	val width = bounds.width.roundToInt()
	val height = bounds.height.roundToInt()
	val argb = IntArray(width * height)
	window.getPixels(argb, 0, width, bounds.left.roundToInt(), bounds.top.roundToInt(), width, height)
	return PixelBitmap(width = width, height = height, argb = argb)
}

fun assertMatchesBaseline(checkpoint: PixelCheckpoint, capture: PixelBitmap) {
	val baselines = PixelBaselines(
		baselineDir = File(checkNotNull(System.getProperty("readplace.pixel.baselines"))),
		failureDir = File(checkNotNull(System.getProperty("readplace.pixel.failures"))),
		isRecording = System.getProperty("readplace.pixel.record") != null,
		tolerance = PIXEL_TOLERANCE,
	)
	when (val outcome = baselines.settle(checkpoint, capture)) {
		CheckpointOutcome.Verified -> Unit
		CheckpointOutcome.Flat -> fail(
			"${checkpoint.relativePath}: the capture is a single colour, so nothing was drawn. " +
				"A pixel test needs @GraphicsMode(GraphicsMode.Mode.NATIVE)",
		)
		is CheckpointOutcome.Recorded -> fail(
			"recorded ${outcome.file}. A recording run never passes: open the picture at full size, " +
				"commit it, then run make test without RECORD_SNAPSHOTS",
		)
		is CheckpointOutcome.MissingBaseline -> fail(
			"no committed picture ${outcome.file}. Record with: make test RECORD_SNAPSHOTS=1",
		)
		is CheckpointOutcome.Mismatch -> fail("${checkpoint.relativePath}: ${describe(outcome.verdict)}; the capture is at ${outcome.actualFile}")
	}
}

private fun describe(verdict: PixelVerdict): String = when (verdict) {
	PixelVerdict.Match -> "matched"
	is PixelVerdict.SizeMismatch ->
		"the picture is ${verdict.expectedWidth}x${verdict.expectedHeight} but the leaf now draws " +
			"${verdict.actualWidth}x${verdict.actualHeight}"
	is PixelVerdict.TooManyDiffering ->
		"${verdict.differing} of ${verdict.total} pixels differ (differing=${verdict.differing}, " +
			"total=${verdict.total}, smallestPassingThreshold=${verdict.smallestPassingThreshold})"
}
