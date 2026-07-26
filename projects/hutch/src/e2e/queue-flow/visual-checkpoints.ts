import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { measuredBox, type VisualCheckpoint } from '../visual-checkpoint'
import type { QueueFlowActionKey } from './action-catalog'

const EMPTY_QUEUE_REGION = '[data-test-empty-queue]'
const EMPTY_QUEUE_TITLE = `${EMPTY_QUEUE_REGION} .queue__empty-title`
const EMPTY_STATE_HORIZONTAL_PADDING_PX = 20

async function emptyQueueSettled(page: Page): Promise<void> {
	await page.waitForSelector('body.page-queue')
	await page.waitForSelector(EMPTY_QUEUE_REGION)
}

async function emptyQueueGeometry(page: Page): Promise<void> {
	const region = await measuredBox(page, EMPTY_QUEUE_REGION)
	const title = await measuredBox(page, EMPTY_QUEUE_TITLE)
	const leftInset = title.x - region.x
	const rightInset = region.x + region.width - (title.x + title.width)
	assert.equal(
		leftInset,
		EMPTY_STATE_HORIZONTAL_PADDING_PX,
		'empty-state title left inset must equal the region horizontal padding',
	)
	assert.equal(
		rightInset,
		EMPTY_STATE_HORIZONTAL_PADDING_PX,
		'empty-state title right inset must equal the region horizontal padding',
	)
}

const QUEUE_FLOW_VISUAL_CHECKPOINTS: ReadonlyArray<[QueueFlowActionKey, VisualCheckpoint]> = [
	[
		'cleanup-previous-articles',
		{
			name: 'queue-empty',
			settled: emptyQueueSettled,
			geometry: emptyQueueGeometry,
			target: EMPTY_QUEUE_REGION,
			pinnedText: [],
		},
	],
]

export const visualCheckpoints = new Map<string, VisualCheckpoint>(QUEUE_FLOW_VISUAL_CHECKPOINTS)
