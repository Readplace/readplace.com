package com.readplace.android.app

import android.content.Context
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.ViewConfiguration
import android.webkit.WebView
import androidx.core.view.NestedScrollingChild3
import androidx.core.view.NestedScrollingChildHelper
import androidx.core.view.ViewCompat
import kotlin.math.abs

class NestedScrollWebView(context: Context) : WebView(context), NestedScrollingChild3 {
	private val childHelper = NestedScrollingChildHelper(this)
	private val scrollConsumed = IntArray(2)
	private val scrollOffset = IntArray(2)
	private val minimumFlingVelocity = ViewConfiguration.get(context).scaledMinimumFlingVelocity
	private val maximumFlingVelocity = ViewConfiguration.get(context).scaledMaximumFlingVelocity
	private var velocityTracker: VelocityTracker? = null
	private var lastMotionY = 0
	private var nestedYOffset = 0

	init {
		setNestedScrollingEnabled(true)
	}

	override fun onTouchEvent(event: MotionEvent): Boolean =
		when (event.actionMasked) {
			MotionEvent.ACTION_DOWN -> onTouchDown(event)
			MotionEvent.ACTION_MOVE -> onTouchMove(event)
			MotionEvent.ACTION_UP -> onTouchUp(event)
			MotionEvent.ACTION_CANCEL -> onTouchCancel(event)
			else -> super.onTouchEvent(event)
		}

	private fun onTouchDown(event: MotionEvent): Boolean {
		nestedYOffset = 0
		lastMotionY = event.y.toInt()
		obtainVelocityTracker().addMovement(event)
		startNestedScroll(SCROLL_AXIS_VERTICAL, ViewCompat.TYPE_TOUCH)
		parent?.requestDisallowInterceptTouchEvent(true)
		return super.onTouchEvent(event)
	}

	private fun onTouchMove(event: MotionEvent): Boolean {
		val y = event.y.toInt()
		var deltaY = lastMotionY - y
		scrollOffset[1] = 0
		if (dispatchNestedPreScroll(0, deltaY, scrollConsumed, scrollOffset, ViewCompat.TYPE_TOUCH)) {
			deltaY -= scrollConsumed[1]
			nestedYOffset += scrollConsumed[1] + scrollOffset[1]
		}
		lastMotionY = y - scrollOffset[1]

		val adjusted = MotionEvent.obtain(event)
		adjusted.offsetLocation(0f, nestedYOffset.toFloat())
		val handled = super.onTouchEvent(adjusted)
		obtainVelocityTracker().addMovement(adjusted)
		adjusted.recycle()

		val unconsumed = if (canScrollFurther(deltaY)) 0 else deltaY
		scrollConsumed[1] = 0
		scrollOffset[1] = 0
		dispatchNestedScroll(0, deltaY - unconsumed, 0, unconsumed, scrollOffset, ViewCompat.TYPE_TOUCH, scrollConsumed)
		lastMotionY -= scrollOffset[1]
		nestedYOffset += scrollOffset[1]
		return handled
	}

	private fun onTouchUp(event: MotionEvent): Boolean {
		val tracker = obtainVelocityTracker()
		tracker.addMovement(event)
		tracker.computeCurrentVelocity(VELOCITY_UNITS, maximumFlingVelocity.toFloat())
		val scrollVelocity = -tracker.yVelocity
		val handled = super.onTouchEvent(event)
		endTouch(flingVelocity = if (abs(scrollVelocity) >= minimumFlingVelocity) scrollVelocity else 0f)
		return handled
	}

	private fun onTouchCancel(event: MotionEvent): Boolean {
		val handled = super.onTouchEvent(event)
		endTouch(flingVelocity = 0f)
		return handled
	}

	private fun endTouch(flingVelocity: Float) {
		if (!dispatchNestedPreFling(0f, flingVelocity)) {
			dispatchNestedFling(0f, flingVelocity, canScrollFurther(flingVelocity.toInt()))
		}
		velocityTracker?.recycle()
		velocityTracker = null
		stopNestedScroll(ViewCompat.TYPE_TOUCH)
		parent?.requestDisallowInterceptTouchEvent(false)
	}

	private fun canScrollFurther(scrollDelta: Int): Boolean =
		canScrollVertically(if (scrollDelta > 0) 1 else -1)

	private fun obtainVelocityTracker(): VelocityTracker =
		velocityTracker ?: VelocityTracker.obtain().also { velocityTracker = it }

	override fun setNestedScrollingEnabled(enabled: Boolean) {
		childHelper.isNestedScrollingEnabled = enabled
	}

	override fun isNestedScrollingEnabled(): Boolean = childHelper.isNestedScrollingEnabled

	override fun startNestedScroll(axes: Int): Boolean = childHelper.startNestedScroll(axes)

	override fun startNestedScroll(axes: Int, type: Int): Boolean = childHelper.startNestedScroll(axes, type)

	override fun stopNestedScroll() = childHelper.stopNestedScroll()

	override fun stopNestedScroll(type: Int) = childHelper.stopNestedScroll(type)

	override fun hasNestedScrollingParent(): Boolean = childHelper.hasNestedScrollingParent()

	override fun hasNestedScrollingParent(type: Int): Boolean = childHelper.hasNestedScrollingParent(type)

	override fun dispatchNestedScroll(
		dxConsumed: Int,
		dyConsumed: Int,
		dxUnconsumed: Int,
		dyUnconsumed: Int,
		offsetInWindow: IntArray?,
	): Boolean = childHelper.dispatchNestedScroll(dxConsumed, dyConsumed, dxUnconsumed, dyUnconsumed, offsetInWindow)

	override fun dispatchNestedScroll(
		dxConsumed: Int,
		dyConsumed: Int,
		dxUnconsumed: Int,
		dyUnconsumed: Int,
		offsetInWindow: IntArray?,
		type: Int,
	): Boolean =
		childHelper.dispatchNestedScroll(dxConsumed, dyConsumed, dxUnconsumed, dyUnconsumed, offsetInWindow, type)

	override fun dispatchNestedScroll(
		dxConsumed: Int,
		dyConsumed: Int,
		dxUnconsumed: Int,
		dyUnconsumed: Int,
		offsetInWindow: IntArray?,
		type: Int,
		consumed: IntArray,
	) = childHelper.dispatchNestedScroll(
		dxConsumed,
		dyConsumed,
		dxUnconsumed,
		dyUnconsumed,
		offsetInWindow,
		type,
		consumed,
	)

	override fun dispatchNestedPreScroll(
		dx: Int,
		dy: Int,
		consumed: IntArray?,
		offsetInWindow: IntArray?,
	): Boolean = childHelper.dispatchNestedPreScroll(dx, dy, consumed, offsetInWindow)

	override fun dispatchNestedPreScroll(
		dx: Int,
		dy: Int,
		consumed: IntArray?,
		offsetInWindow: IntArray?,
		type: Int,
	): Boolean = childHelper.dispatchNestedPreScroll(dx, dy, consumed, offsetInWindow, type)

	override fun dispatchNestedFling(velocityX: Float, velocityY: Float, consumed: Boolean): Boolean =
		childHelper.dispatchNestedFling(velocityX, velocityY, consumed)

	override fun dispatchNestedPreFling(velocityX: Float, velocityY: Float): Boolean =
		childHelper.dispatchNestedPreFling(velocityX, velocityY)
}

private const val VELOCITY_UNITS = 1000
