import assert from 'node:assert/strict'
import type { Page } from '@playwright/test'
import { expect, measuredBox, type VisualCheckpoint } from '@packages/e2e-harness'
import type { QueueFlowActionKey } from './action-catalog'

const EMPTY_QUEUE_REGION = '[data-test-empty-queue]'
const EMPTY_QUEUE_TITLE = `${EMPTY_QUEUE_REGION} .queue__empty-title`
const EMPTY_STATE_HORIZONTAL_PADDING_PX = 20
const PAGINATION_REGION = '[data-test-pagination]'
const PAGINATION_INFO = '[data-test-pagination-info]'
const PAGINATION_NEXT_LINK = '[data-test-pagination-next]'

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

async function paginationPage1Settled(page: Page): Promise<void> {
	await page.waitForSelector('body.page-queue')
	await page.waitForSelector(PAGINATION_NEXT_LINK)
	await expect(page.locator(PAGINATION_INFO)).toHaveText('Page 1 of 2')
}

async function paginationPage1Geometry(page: Page): Promise<void> {
	const row = await measuredBox(page, PAGINATION_REGION)
	const nextLink = await measuredBox(page, PAGINATION_NEXT_LINK)
	assert.equal(
		nextLink.x + nextLink.width,
		row.x + row.width,
		'the Next link must sit on the row right edge, where the page count cannot push it',
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
			capture: 'element',
			pinnedText: [],
		},
	],
	[
		'verify-page1-has-next',
		{
			name: 'queue-pagination-page-1',
			settled: paginationPage1Settled,
			geometry: paginationPage1Geometry,
			target: PAGINATION_REGION,
			capture: 'element',
			pinnedText: [],
		},
	],
]

export const visualCheckpoints = new Map<string, VisualCheckpoint>(QUEUE_FLOW_VISUAL_CHECKPOINTS)

assert.equal(
	visualCheckpoints.size,
	QUEUE_FLOW_VISUAL_CHECKPOINTS.length,
	'duplicate action key in QUEUE_FLOW_VISUAL_CHECKPOINTS — a repeated key silently drops every checkpoint under it except the last',
)
