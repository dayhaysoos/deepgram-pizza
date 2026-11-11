import { describe, expect, it, vi } from 'vitest'
import { summarizeCart } from '../agent/cartSummary'
import { createToolHandlers, type ToolHandler } from '../agent/handlers'
import { PLAN_LINE, SAID_WHEN_CALLED } from '../agent/tools'
import { answerToolCall } from './ClientTools'

/** A call as the SDK hands it to a client tool: Deepgram's FunctionCallRequest entry. */
const call = (name: string, args: string) => ({ id: 'fc-1', name, arguments: args, client_side: true })

describe('answerToolCall', () => {
  it("passes the handler the call's arguments, not the whole call", async () => {
    const handler = vi.fn<ToolHandler>(async () => ({ message: 'unused' }))
    await answerToolCall(handler, call('add_item', '{"id":"fries","quantity":1}'))
    expect(handler).toHaveBeenCalledExactlyOnceWith('{"id":"fries","quantity":1}')
  })

  it("answers with the handler's result as JSON, the string a FunctionCallResponse carries", async () => {
    const handlers = createToolHandlers({
      cart: { now: () => ({}), cartDetails: () => ({}), change: () => summarizeCart({}) },
      ui: { highlight() {}, showSuggestions() {}, closeSuggestions() {}, isShowingSuggestions: () => false, openCart() {}, goToCheckout() {} },
      orderType: { get: () => null, set() {} },
      checkout: async () => ({ message: 'unused' }),
    })

    expect(await answerToolCall(handlers.view_cart, call('view_cart', '{}'))).toBe('{"lines":[],"count":0,"total":"$0.00","totalSpoken":"zero dollars"}')
    // A recovery is an answer too: the agent hears it and tries again.
    expect(JSON.parse(await answerToolCall(handlers.checkout, call('checkout', '{}')))).toEqual({
      message: 'The cart is empty.',
    })
  })

  // The owner wanted the agent to say it's putting something together before the plan's card comes up (2026-11-11).
  it('has the agent say the tool\'s line first, queued, before the handler runs', async () => {
    const order: string[] = []
    const agent = { injectAgentMessage: vi.fn(() => void order.push('line')) }
    const handler = vi.fn<ToolHandler>(async () => {
      order.push('handler')
      return { message: 'unused' }
    })

    await answerToolCall(handler, call('plan_group_order', '{"people":30}'), { line: PLAN_LINE, agent })

    expect(agent.injectAgentMessage).toHaveBeenCalledExactlyOnceWith('Let me put something together.', 'queue')
    expect(order).toEqual(['line', 'handler'])
  })

  it('has a line only for plan_group_order: a plan takes a moment and puts something on screen', () => {
    expect(SAID_WHEN_CALLED).toEqual({ plan_group_order: 'Let me put something together.' })
  })
})
