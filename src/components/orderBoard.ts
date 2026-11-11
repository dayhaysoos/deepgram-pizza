// The cart as an order board, like a drive-thru's (the owner, 2026-11-11):
// lines key in one by one as they're added, each lighting up as it lands; a
// changed quantity lights its line up again; a line taken out is struck
// through and fades. "Add all of that" puts a plan's lines in the cart at
// once, and the board keys them in KEY_IN_MS apart while the agent reads them
// back, the first at once. The board's total counts only the lines keyed in
// so far, so it climbs with them.
//
// It hears every change the page makes, tapped or asked for by voice, from
// the page's cart changes (`subscribe` in src/agent/cartChanges.ts), with the
// cart before and after it. A cart that changes any other way (loaded from
// the browser's storage, emptied after paying) just shows as it is.
//
// The state and what the board shows are plain functions (`updateBoard`,
// `boardLines`); `createOrderBoard` holds the state and its timers, as an
// external store React reads with useSyncExternalStore, the way
// use-shopping-cart's hook reads the cart, so a change reaches the cart and
// the board in the same render, and a new line never shows before its turn.
// No React here: useOrderBoard.ts wires it to the page.

import { quantityOf, type Quantities } from '../agent/cartSummary'

/** How long after one line keys in the next one does: about a third of a second, like a cashier keying them. */
export const KEY_IN_MS = 350
/** How long a keyed-in or changed line stays lit. styles.css's `line-lit` animation lasts as long. */
export const LIT_MS = 1_200
/** How long a line taken out stays, struck through, as it fades. styles.css's `line-leave` animation lasts as long. */
export const LEAVE_MS = 700

/** How a line on the board is marked: just keyed in, just changed, or on its way out. */
export type BoardMark = 'new' | 'changed' | 'leaving'

/** A line as the board shows it, in the cart's order, with lines on their way out where they were. */
export type BoardLine = { id: string; quantity: number; mark?: BoardMark }

/** The last line keyed in, changed or taken out: the phone strip shows it. `seq` is new each time. */
export type LatestLine = { id: string; quantity: number; kind: 'added' | 'changed' | 'removed'; seq: number }

export type BoardState = {
  /** Lines added but not keyed in yet, in the order they key in, with their quantity now. */
  waiting: ReadonlyArray<{ id: string; quantity: number }>
  /** Lines lit up now, by id, each with the `seq` of what lit it. */
  marks: Readonly<Record<string, { mark: 'new' | 'changed'; seq: number }>>
  /** Lines taken out, kept while they fade, with where they were among the lines shown. */
  leaving: ReadonlyArray<{ id: string; quantity: number; index: number; seq: number }>
  latest: LatestLine | null
  /** The last `seq` handed out. Each mark gets the next one, so a settle clears only the mark it was for. */
  seq: number
}

export const EMPTY_BOARD: BoardState = { waiting: [], marks: {}, leaving: [], latest: null, seq: 0 }

export type BoardEvent =
  /** The page changed the cart: the cart before the change, and after it. */
  | { type: 'changed'; before: Quantities; after: Quantities }
  /** The next waiting line keys in. */
  | { type: 'keyIn' }
  /** The mark, or the line on its way out, with this `seq` is over. */
  | { type: 'settle'; seq: number }

/** The board after an event. The state passed in is left as it was. */
export function updateBoard(state: BoardState, event: BoardEvent): BoardState {
  switch (event.type) {
    case 'changed':
      return changed(state, event.before, event.after)
    case 'keyIn': {
      const [next, ...waiting] = state.waiting
      if (!next) return state
      const seq = state.seq + 1
      return {
        ...state,
        waiting,
        marks: { ...state.marks, [next.id]: { mark: 'new', seq } },
        latest: { ...next, kind: 'added', seq },
        seq,
      }
    }
    case 'settle': {
      const marks = Object.fromEntries(Object.entries(state.marks).filter(([, { seq }]) => seq !== event.seq))
      const leaving = state.leaving.filter(({ seq }) => seq !== event.seq)
      if (Object.keys(marks).length === Object.keys(state.marks).length && leaving.length === state.leaving.length) return state
      return { ...state, marks, leaving }
    }
  }
}

function changed(state: BoardState, before: Quantities, after: Quantities): BoardState {
  let { seq, latest } = state
  const marks = { ...state.marks }
  let leaving = [...state.leaving]
  const waitingIds = new Set(state.waiting.map(({ id }) => id))
  // Where each line stands among the lines shown before the change.
  const shownBefore = Object.keys(before).filter((id) => !waitingIds.has(id))

  // Taken out: struck through where it was, unless it hadn't keyed in yet.
  for (const id of Object.keys(before)) {
    if (Object.hasOwn(after, id)) continue
    delete marks[id]
    if (waitingIds.has(id)) continue
    seq++
    leaving = [...leaving.filter((line) => line.id !== id), { id, quantity: before[id], index: shownBefore.indexOf(id), seq }]
    latest = { id, quantity: before[id], kind: 'removed', seq }
  }

  // Added: waits its turn to key in. Changed: lights up, unless it's still waiting, when it keys in as it is now.
  const waiting = state.waiting.filter(({ id }) => Object.hasOwn(after, id)).map(({ id }) => ({ id, quantity: after[id] }))
  for (const [id, quantity] of Object.entries(after)) {
    const was = quantityOf(before, id)
    if (was === 0) {
      leaving = leaving.filter((line) => line.id !== id)
      if (!waiting.some((line) => line.id === id)) waiting.push({ id, quantity })
    } else if (was !== quantity && !waitingIds.has(id)) {
      seq++
      marks[id] = { mark: 'changed', seq }
      latest = { id, quantity, kind: 'changed', seq }
    }
  }

  return { waiting, marks, leaving, latest, seq }
}

/**
 * What the board shows for this cart: every line but those still waiting to
 * key in, in the cart's order, each with its mark, and the lines on their way
 * out where they were.
 */
export function boardLines(state: BoardState, cart: Quantities): BoardLine[] {
  const waiting = new Set(state.waiting.map(({ id }) => id))
  const lines: BoardLine[] = Object.entries(cart)
    .filter(([id]) => !waiting.has(id))
    .map(([id, quantity]) => {
      const mark = state.marks[id]?.mark
      return mark ? { id, quantity, mark } : { id, quantity }
    })
  for (const gone of [...state.leaving].sort((a, b) => a.index - b.index)) {
    if (Object.hasOwn(cart, gone.id)) continue
    lines.splice(Math.min(Math.max(gone.index, 0), lines.length), 0, { id: gone.id, quantity: gone.quantity, mark: 'leaving' })
  }
  return lines
}

/** The board's state and its timers, as an external store. */
export type OrderBoard = {
  /** For useSyncExternalStore. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** The state now. The same object until something changes. */
  getSnapshot(): BoardState
  /** Hears a change from the page's cart changes: the cart before it, and after it. */
  cartChanged(before: Quantities, after: Quantities): void
}

/** Creates a page's board. The first line a change adds keys in at once; the rest follow KEY_IN_MS apart. */
export function createOrderBoard(): OrderBoard {
  let state = EMPTY_BOARD
  const listeners = new Set<() => void>()
  let keyInTimer: ReturnType<typeof setTimeout> | undefined

  /** Applies an event, and times the end of each mark and fade it started. */
  function apply(event: BoardEvent) {
    const before = state.seq
    state = updateBoard(state, event)
    for (const { seq } of Object.values(state.marks)) {
      if (seq > before) setTimeout(() => settle(seq), LIT_MS)
    }
    for (const { seq } of state.leaving) {
      if (seq > before) setTimeout(() => settle(seq), LEAVE_MS)
    }
  }

  function notify() {
    for (const listener of listeners) listener()
  }

  function settle(seq: number) {
    const before = state
    apply({ type: 'settle', seq })
    if (state !== before) notify()
  }

  function keyInLater() {
    if (state.waiting.length > 0 && keyInTimer === undefined) {
      keyInTimer = setTimeout(() => {
        keyInTimer = undefined
        apply({ type: 'keyIn' })
        keyInLater()
        notify()
      }, KEY_IN_MS)
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => state,
    cartChanged(before, after) {
      apply({ type: 'changed', before, after })
      // With nothing keying in, the first new line keys in with the change itself.
      if (keyInTimer === undefined) apply({ type: 'keyIn' })
      keyInLater()
      notify()
    },
  }
}
