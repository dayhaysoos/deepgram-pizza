import { describe, expect, it } from 'vitest'
import { conversationToggleLabel } from './Captions'

describe('conversationToggleLabel', () => {
  it('says how many lines the conversation has while it is closed', () => {
    expect(conversationToggleLabel(false, 1)).toBe('Show conversation (1)')
    expect(conversationToggleLabel(false, 12)).toBe('Show conversation (12)')
  })

  it('offers to hide the conversation while it is open', () => {
    expect(conversationToggleLabel(true, 12)).toBe('Hide conversation')
  })
})
