// The cart as an order board, like a drive-thru's (the owner, 2026-11-11):
// lines key in one by one as they're added, each lighting up as it lands; a
// changed quantity lights its line up again; a line taken out is struck
// through and fades. The total shown with it is the cart's (useOrderBoard.ts),
// so the board never shows less than Checkout charges.
//
// What the agent adds during a voice session keys in at the pace the agent
// reads it back, like a cashier keying in an order as they repeat it: the
// first line once the agent's voice has started (the session handle's
// `showWithVoice`), and each next one about as long after as the agent takes
// to say the one before (`readBackMs`). In the owner's check of "add all of
// that", six lines a third of a second apart were all in before the agent
// had said the first one. Taps, and changes with no voice session, key in
// KEY_IN_MS apart, the first at once; a tap while the agent's lines are
// keying in shows at once, since the customer did it and the agent isn't
// reading it out.
//
// It hears every change the page makes, tapped or asked for by voice, from
// the page's cart changes (`subscribe` in src/agent/cartChanges.ts), with the
// cart before and after it and who made it. A cart that changes any other way
// (loaded from the browser's storage, emptied after paying) just shows as it is.
//
// The state and what the board shows are plain functions (`updateBoard`,
// `boardLines`); `createOrderBoard` holds the state and its timers, as an
// external store React reads with useSyncExternalStore, the way
// use-shopping-cart's hook reads the cart, so a change reaches the cart and
// the board in the same render, and a new line never shows before its turn.
// No React here: useOrderBoard.ts wires it to the page.

import type { ChangedBy } from '../agent/cartChanges'
import { quantityOf, type Quantities } from '../agent/cartSummary'
import { numberWords } from '../agent/spokenPrice'
import { productName } from '../menu/menu'

/** How long after one line keys in the next one does, for taps: about a third of a second, like a cashier keying them. */
export const KEY_IN_MS = 350

/**
 * How fast the agent reads lines back, in characters a second. In the owner's
 * check on 2026-11-11, "Two large cheese pizzas, three large pepperoni
 * pizzas, …" and its total, 260 characters, took about 13 seconds.
 */
export const READ_BACK_CHARS_PER_SECOND = 20

/** About how long the agent takes to say a line back, "two large cheese pizzas, ", in milliseconds. */
export function readBackMs({ id, quantity }: { id: string; quantity: number }): number {
  return Math.round((`${numberWords(quantity)} ${productName(id)}s, `.length / READ_BACK_CHARS_PER_SECOND) * 1000)
}
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
  /** The page changed the cart: the cart before the change, and after it. With `keyInNow`, the lines it adds key in at once instead of waiting their turn. */
  | { type: 'changed'; before: Quantities; after: Quantities; keyInNow?: true }
  /** The next waiting line keys in. */
  | { type: 'keyIn' }
  /** The mark, or the line on its way out, with this `seq` is over. */
  | { type: 'settle'; seq: number }

/** The board after an event. The state passed in is left as it was. */
export function updateBoard(state: BoardState, event: BoardEvent): BoardState {
  switch (event.type) {
    case 'changed':
      return changed(state, event.before, event.after, event.keyInNow ?? false)
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

function changed(state: BoardState, before: Quantities, after: Quantities, keyInNow: boolean): BoardState {
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

  // Added: waits its turn to key in, or keys in now. Changed: lights up, unless it's still waiting, when it keys in as it is now.
  const waiting = state.waiting.filter(({ id }) => Object.hasOwn(after, id)).map(({ id }) => ({ id, quantity: after[id] }))
  for (const [id, quantity] of Object.entries(after)) {
    const was = quantityOf(before, id)
    if (was === 0) {
      leaving = leaving.filter((line) => line.id !== id)
      if (keyInNow) {
        seq++
        marks[id] = { mark: 'new', seq }
        latest = { id, quantity, kind: 'added', seq }
      } else if (!waiting.some((line) => line.id === id)) waiting.push({ id, quantity })
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
  /** Hears a change from the page's cart changes: the cart before it and after it, and who made it (a tap, unless said). */
  cartChanged(before: Quantities, after: Quantities, by?: ChangedBy): void
}

/** How the board knows the agent will read back what it adds. In the app, from the voice session's handle. */
export type BoardVoice = {
  /** Whether a voice session is on, so the agent will read back what it adds. */
  isOn(): boolean
  /** Calls `start` once the agent's voice has started. Returns the function that cancels it. */
  showWithVoice(start: () => void): () => void
}

const NO_VOICE: BoardVoice = {
  isOn: () => false,
  showWithVoice(start) {
    start()
    return () => {}
  },
}

/**
 * Creates a page's board. What a tap adds keys in KEY_IN_MS apart, the first
 * at once; what the agent adds while `voice` is on keys in at its read-back pace.
 */
export function createOrderBoard(voice: BoardVoice = NO_VOICE): OrderBoard {
  let state = EMPTY_BOARD
  const listeners = new Set<() => void>()
  let keyInTimer: ReturnType<typeof setTimeout> | undefined
  // Whether the lines waiting key in at the agent's pace, and whether they're waiting for its voice to start.
  let paced = false
  let waitingForVoice = false

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

  /** Keys the next line in, and times the one after: as long as saying this one takes, when paced. */
  function keyInNext() {
    const next = state.waiting[0]
    apply({ type: 'keyIn' })
    if (state.waiting.length === 0 || !next) return
    keyInTimer = setTimeout(
      () => {
        keyInTimer = undefined
        keyInNext()
        notify()
      },
      paced ? readBackMs(next) : KEY_IN_MS,
    )
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => state,
    cartChanged(before, after, by = 'tap') {
      const keyingIn = keyInTimer !== undefined || waitingForVoice
      // A tap while the agent's lines key in shows at once; any other change joins the queue.
      apply({ type: 'changed', before, after, ...(by === 'tap' && keyingIn && paced && { keyInNow: true }) })
      if (!keyingIn && state.waiting.length > 0) {
        paced = by === 'agent' && voice.isOn()
        if (paced) {
          waitingForVoice = true
          voice.showWithVoice(() => {
            waitingForVoice = false
            keyInNext()
            notify()
          })
        } else {
          keyInNext()
        }
      }
      notify()
    },
  }
}
