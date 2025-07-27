import { describe, expect, test } from 'vitest'
import type { BlockState } from './types'
import { convertLoopBlockToLoop } from './utils'

describe('convertLoopBlockToLoop', () => {
  test('should parse JSON array string for forEach loops', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'forEach',
          count: 10,
          collection: '["item1", "item2", "item3"]',
        },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.loopType).toBe('forEach')
    expect(result?.forEachItems).toEqual(['item1', 'item2', 'item3'])
    expect(result?.iterations).toBe(10)
  })

  test('should parse JSON object string for forEach loops', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'forEach',
          count: 5,
          collection: '{"key1": "value1", "key2": "value2"}',
        },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.loopType).toBe('forEach')
    expect(result?.forEachItems).toEqual({ key1: 'value1', key2: 'value2' })
  })

  test('should keep string as-is if not valid JSON', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'forEach',
          count: 5,
          collection: '<blockName.items>',
        },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.forEachItems).toBe('<blockName.items>')
  })

  test('should handle empty collection', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'forEach',
          count: 5,
          collection: '',
        },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.forEachItems).toBe('')
  })

  test('should handle for loops without collection parsing', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'for',
          count: 5,
          collection: '["should", "not", "matter"]',
        },
      },
    }

    const result = convertLoopBlockToLoop('loop1', blocks)

    expect(result).toBeDefined()
    expect(result?.loopType).toBe('for')
    expect(result?.iterations).toBe(5)
    // For 'for' loops, the collection is still parsed in case it's later changed to forEach
    expect(result?.forEachItems).toEqual(['should', 'not', 'matter'])
  })
})
