import { describe, expect, it, vi } from 'vitest'
import { summarizeCart } from '../agent/cartSummary'
import { createToolHandlers, type ToolHandler } from '../agent/handlers'
import { answerToolCall } from './ClientTools'

/** A call as the SDK hands it to a client tool: Deepgram's FunctionCallRequest entry. */
const call = (name: string, args: string) => ({ id: 'fc-1', name, arguments: args, client_side: true })

describe('answerToolCall', () => {
  it("passes the handler the call's arguments, not the whole call", async () => {
    const handler = vi.fn<ToolHandler>(async () => ({ ok: true }))
    await answerToolCall(handler, call('add_item', '{"id":"fries","quantity":1}'))
    expect(handler).toHaveBeenCalledExactlyOnceWith('{"id":"fries","quantity":1}')
  })

  it("answers with the handler's result as JSON, the string a FunctionCallResponse carries", async () => {
    const handlers = createToolHandlers({
      cart: { now: () => ({}), cartDetails: () => ({}), change: () => summarizeCart({}) },
      ui: { highlight() {}, showSuggestions() {}, closeSuggestions() {}, openCart() {}, goToCheckout() {} },
      checkout: async () => ({ message: 'unused' }),
    })

    expect(await answerToolCall(handlers.view_cart, call('view_cart', '{}'))).toBe('{"lines":[],"count":0,"total":"$0.00"}')
    // A recovery is an answer too: the agent hears it and tries again.
    expect(JSON.parse(await answerToolCall(handlers.checkout, call('checkout', '{}')))).toEqual({
      message: 'The cart is empty.',
    })
  })
})
