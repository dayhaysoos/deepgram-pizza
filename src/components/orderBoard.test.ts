import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Quantities } from '../agent/cartSummary'
import {
  boardLines,
  createOrderBoard,
  EMPTY_BOARD,
  KEY_IN_MS,
  LEAVE_MS,
  LIT_MS,
  updateBoard,
  type BoardState,
} from './orderBoard'

/** The owner's party of 30, added with "add all of that". */
const plan: Quantities = {
  'cheese-pizza-large': 2,
  'pepperoni-pizza-large': 3,
  'margherita-pizza-large': 1,
  'garlic-knots': 6,
  soda: 17,
}

/** A board driven the way the page drives it: each change goes to the board, and the cart is then what it shows lines for. */
function setUp(start: Quantities = {}) {
  const board = createOrderBoard()
  let cart = start
  const notified = vi.fn()
  board.subscribe(notified)
  return {
    board,
    notified,
    change(after: Quantities) {
      const before = cart
      cart = after
      board.cartChanged(before, after)
    },
    shown: () => boardLines(board.getSnapshot(), cart),
    ids: () => boardLines(board.getSnapshot(), cart).map(({ id }) => id),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the order board', () => {
  it('keys in the lines a change adds one by one, the first at once, each lit as it lands', () => {
    const { change, shown, ids } = setUp()

    change(plan)
    expect(shown()).toEqual([{ id: 'cheese-pizza-large', quantity: 2, mark: 'new' }])

    vi.advanceTimersByTime(KEY_IN_MS)
    expect(ids()).toEqual(['cheese-pizza-large', 'pepperoni-pizza-large'])
    expect(shown()[1]).toEqual({ id: 'pepperoni-pizza-large', quantity: 3, mark: 'new' })

    vi.advanceTimersByTime(KEY_IN_MS * 3)
    expect(ids()).toEqual(Object.keys(plan))
  })

  it('stops lighting a line up once it has been lit for a moment', () => {
    const { change, shown } = setUp()
    change({ fries: 1 })
    expect(shown()).toEqual([{ id: 'fries', quantity: 1, mark: 'new' }])

    vi.advanceTimersByTime(LIT_MS - 1)
    expect(shown()[0].mark).toBe('new')
    vi.advanceTimersByTime(1)
    expect(shown()).toEqual([{ id: 'fries', quantity: 1 }])
  })

  it('lights a line up again when its quantity changes, and says so as the latest', () => {
    const { board, change, shown } = setUp()
    change({ 'margherita-pizza-large': 2 })
    vi.advanceTimersByTime(LIT_MS)

    change({ 'margherita-pizza-large': 1 })

    expect(shown()).toEqual([{ id: 'margherita-pizza-large', quantity: 1, mark: 'changed' }])
    expect(board.getSnapshot().latest).toMatchObject({ id: 'margherita-pizza-large', quantity: 1, kind: 'changed' })
  })

  it('strikes a line taken out where it was, then lets it go', () => {
    const { change, shown, ids } = setUp()
    change({ fries: 1, soda: 2, lemonade: 1 })
    vi.advanceTimersByTime(KEY_IN_MS * 2 + LIT_MS)

    change({ fries: 1, lemonade: 1 })

    expect(shown()).toEqual([
      { id: 'fries', quantity: 1 },
      { id: 'soda', quantity: 2, mark: 'leaving' },
      { id: 'lemonade', quantity: 1 },
    ])
    vi.advanceTimersByTime(LEAVE_MS)
    expect(ids()).toEqual(['fries', 'lemonade'])
  })

  it('drops a line still waiting to key in when it goes, without striking it', () => {
    const { change, ids } = setUp()
    change(plan)

    change({})

    // Only the line that had keyed in fades, and nothing else keys in meanwhile.
    expect(ids()).toEqual(['cheese-pizza-large'])
    vi.advanceTimersByTime(KEY_IN_MS)
    expect(ids()).toEqual(['cheese-pizza-large'])
    vi.advanceTimersByTime(LEAVE_MS - KEY_IN_MS)
    expect(ids()).toEqual([])
    vi.advanceTimersByTime(KEY_IN_MS * 10)
    expect(ids()).toEqual([])
  })

  it('keys a waiting line in with its quantity as it is then', () => {
    const { board, change, shown } = setUp()
    change({ fries: 1, soda: 2 })
    change({ fries: 1, soda: 5 })

    vi.advanceTimersByTime(KEY_IN_MS)

    expect(shown()[1]).toEqual({ id: 'soda', quantity: 5, mark: 'new' })
    expect(board.getSnapshot().latest).toMatchObject({ id: 'soda', quantity: 5, kind: 'added' })
  })

  it('keys a later change in after the lines still waiting, in order', () => {
    const { change, ids } = setUp()
    change({ fries: 1, soda: 2 })
    change({ fries: 1, soda: 2, lemonade: 1 })

    expect(ids()).toEqual(['fries'])
    vi.advanceTimersByTime(KEY_IN_MS)
    expect(ids()).toEqual(['fries', 'soda'])
    vi.advanceTimersByTime(KEY_IN_MS)
    expect(ids()).toEqual(['fries', 'soda', 'lemonade'])
  })

  it('shows a cart that changed some other way just as it is: one loaded from storage never keys in', () => {
    expect(boardLines(EMPTY_BOARD, { fries: 1, soda: 2 })).toEqual([
      { id: 'fries', quantity: 1 },
      { id: 'soda', quantity: 2 },
    ])
  })

  it('tells its subscribers about each change, and each line keyed in', () => {
    const { change, notified } = setUp()
    change({ fries: 1, soda: 2 })
    expect(notified).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(KEY_IN_MS)
    expect(notified).toHaveBeenCalledTimes(2)
  })

  it('keeps the latest line for the phone strip: added as each keys in, removed when one goes', () => {
    const { board, change } = setUp()
    change({ fries: 1, soda: 2 })
    expect(board.getSnapshot().latest).toMatchObject({ id: 'fries', kind: 'added' })
    vi.advanceTimersByTime(KEY_IN_MS)
    expect(board.getSnapshot().latest).toMatchObject({ id: 'soda', quantity: 2, kind: 'added' })

    change({ soda: 2 })
    expect(board.getSnapshot().latest).toMatchObject({ id: 'fries', quantity: 1, kind: 'removed' })
  })
})

describe('updateBoard', () => {
  it('leaves the state as it was', () => {
    const state: BoardState = { ...EMPTY_BOARD, waiting: [{ id: 'fries', quantity: 1 }] }
    const next = updateBoard(state, { type: 'keyIn' })
    expect(state.waiting).toEqual([{ id: 'fries', quantity: 1 }])
    expect(next.waiting).toEqual([])
  })

  it('returns the same state for an event that changes nothing', () => {
    expect(updateBoard(EMPTY_BOARD, { type: 'keyIn' })).toBe(EMPTY_BOARD)
    expect(updateBoard(EMPTY_BOARD, { type: 'settle', seq: 1 })).toBe(EMPTY_BOARD)
  })

  it('clears only the mark a settle was for, not a newer one on the same line', () => {
    let state = updateBoard(EMPTY_BOARD, { type: 'changed', before: {}, after: { fries: 1 } })
    state = updateBoard(state, { type: 'keyIn' })
    const keyedIn = state.marks.fries.seq
    state = updateBoard(state, { type: 'changed', before: { fries: 1 }, after: { fries: 2 } })

    state = updateBoard(state, { type: 'settle', seq: keyedIn })

    expect(state.marks.fries).toMatchObject({ mark: 'changed' })
  })
})
