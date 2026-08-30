package com.readplace.android.app

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import androidx.core.view.NestedScrollingParent3
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class NestedScrollWebViewTest {
	private val context: Context get() = RuntimeEnvironment.getApplication()

	@Test
	fun `a drag the page cannot absorb reaches the parent as unconsumed scroll`() {
		val parent = RecordingScrollParent(context)
		val webView = NestedScrollWebView(context)
		parent.addView(webView)

		webView.onTouchEvent(motion(MotionEvent.ACTION_DOWN, y = 500f))
		webView.onTouchEvent(motion(MotionEvent.ACTION_MOVE, y = 600f))

		assertEquals("a 100px downward drag on an unscrolled page reaches the parent", -100, parent.unconsumedY)
	}

	@Test
	fun `the parent accepts the drag before the page sees it`() {
		val parent = RecordingScrollParent(context)
		val webView = NestedScrollWebView(context)
		parent.addView(webView)

		webView.onTouchEvent(motion(MotionEvent.ACTION_DOWN, y = 500f))

		assertTrue("the touch opens a nested scroll the parent can steer", webView.hasNestedScrollingParent())
	}

	@Test
	fun `what the parent consumes up front never reaches the page as unconsumed`() {
		val parent = RecordingScrollParent(context, consumesY = -40)
		val webView = NestedScrollWebView(context)
		parent.addView(webView)

		webView.onTouchEvent(motion(MotionEvent.ACTION_DOWN, y = 500f))
		webView.onTouchEvent(motion(MotionEvent.ACTION_MOVE, y = 600f))

		assertEquals("the parent's own 40px is not offered back to it", -60, parent.unconsumedY)
	}

	@Test
	fun `the touch is claimed back from the ancestors that would otherwise steal it`() {
		val parent = RecordingScrollParent(context)
		val webView = NestedScrollWebView(context)
		parent.addView(webView)

		webView.onTouchEvent(motion(MotionEvent.ACTION_DOWN, y = 500f))
		webView.onTouchEvent(motion(MotionEvent.ACTION_MOVE, y = 600f))
		webView.onTouchEvent(motion(MotionEvent.ACTION_UP, y = 600f))

		assertEquals(
			"the drag is claimed for the page and released when the finger lifts",
			listOf(true, false),
			parent.disallowIntercept,
		)
	}

	@Test
	fun `a release too slow to fling still hands the parent a fling to settle on`() {
		val parent = RecordingScrollParent(context)
		val webView = NestedScrollWebView(context)
		parent.addView(webView)

		webView.onTouchEvent(motion(MotionEvent.ACTION_DOWN, y = 500f))
		webView.onTouchEvent(motion(MotionEvent.ACTION_MOVE, y = 600f))
		webView.onTouchEvent(motion(MotionEvent.ACTION_UP, y = 600f))

		assertEquals(
			"a finger that stops before lifting still offers the parent a fling to settle on",
			listOf(0f) to listOf(0f),
			parent.preFlingVelocities to parent.flingVelocities,
		)
	}

	@Test
	fun `a cancelled gesture still hands the parent a fling to settle on`() {
		val parent = RecordingScrollParent(context)
		val webView = NestedScrollWebView(context)
		parent.addView(webView)

		webView.onTouchEvent(motion(MotionEvent.ACTION_DOWN, y = 500f))
		webView.onTouchEvent(motion(MotionEvent.ACTION_MOVE, y = 600f))
		webView.onTouchEvent(motion(MotionEvent.ACTION_CANCEL, y = 600f))

		assertEquals(
			"a gesture the system takes away settles the parent and releases the touch",
			listOf(0f) to listOf(true, false),
			parent.flingVelocities to parent.disallowIntercept,
		)
	}

	@Test
	fun `a fast release passes the finger's velocity to the parent`() {
		val parent = RecordingScrollParent(context)
		val webView = NestedScrollWebView(context)
		parent.addView(webView)

		webView.onTouchEvent(motion(MotionEvent.ACTION_DOWN, y = 500f, at = 0L))
		webView.onTouchEvent(motion(MotionEvent.ACTION_MOVE, y = 600f, at = 100L))
		webView.onTouchEvent(motion(MotionEvent.ACTION_UP, y = 610f, at = 110L))

		assertEquals(
			"100px of finger travel over 100ms reaches the parent as 1000px/s of scroll",
			listOf(-1000f),
			parent.flingVelocities,
		)
	}

	private fun motion(action: Int, y: Float, at: Long = 0L): MotionEvent =
		MotionEvent.obtain(0L, at, action, 0f, y, 0)

	private class RecordingScrollParent(context: Context, private val consumesY: Int = 0) :
		FrameLayout(context), NestedScrollingParent3 {
		var unconsumedY = 0
		val disallowIntercept = mutableListOf<Boolean>()
		val preFlingVelocities = mutableListOf<Float>()
		val flingVelocities = mutableListOf<Float>()

		override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
			this.disallowIntercept += disallowIntercept
			super.requestDisallowInterceptTouchEvent(disallowIntercept)
		}

		override fun onStartNestedScroll(child: View, target: View, axes: Int, type: Int): Boolean = true

		override fun onNestedScrollAccepted(child: View, target: View, axes: Int, type: Int) = Unit

		override fun onStopNestedScroll(target: View, type: Int) = Unit

		override fun onNestedPreFling(target: View, velocityX: Float, velocityY: Float): Boolean {
			preFlingVelocities += velocityY
			return false
		}

		override fun onNestedFling(target: View, velocityX: Float, velocityY: Float, consumed: Boolean): Boolean {
			flingVelocities += velocityY
			return false
		}

		override fun onNestedPreScroll(target: View, dx: Int, dy: Int, consumed: IntArray, type: Int) {
			consumed[1] = consumesY
		}

		override fun onNestedScroll(
			target: View,
			dxConsumed: Int,
			dyConsumed: Int,
			dxUnconsumed: Int,
			dyUnconsumed: Int,
			type: Int,
		) {
			unconsumedY += dyUnconsumed
		}

		override fun onNestedScroll(
			target: View,
			dxConsumed: Int,
			dyConsumed: Int,
			dxUnconsumed: Int,
			dyUnconsumed: Int,
			type: Int,
			consumed: IntArray,
		) {
			unconsumedY += dyUnconsumed
		}
	}
}
