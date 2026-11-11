// The panel on /dev/tools: runs the voice agent's tools by hand, so the page
// can be built and tested without a microphone. It calls the page's own tool
// handlers (useToolHandlers), the set the voice session uses, so a run here
// changes the page exactly as the agent's tool call would, and shows the result
// the agent would get back. Its first section is the voice session log
// (SessionLogSection.tsx), to read and copy while you talk.
//
// Dev only: src/routes/dev.tools.tsx loads this module only when
// import.meta.env.DEV is true, so production builds leave it, and its styles, out.

import { useEffect, useId, useRef, useState } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import type { ItemQuantity, Quantities } from '../agent/cartSummary'
import type { ToolResult } from '../agent/handlers'
import { planGroupOrder, type GroupOrderRequest } from '../agent/planGroupOrder'
import { toolDefinitions, type ToolName } from '../agent/tools'
import { defaultVariant, findItem } from '../menu/menu'
import { useCartChanges, useToolHandlers } from '../pageContext'
import { SessionLogSection } from './SessionLogSection'
import './ToolsPanel.css'

/** An update a tap would send the agent, as the panel logs it. */
export type LoggedUpdate = { id: number; time: Date; text: string }

type Args = Record<string, unknown>

type Preset = {
  label: string
  tool: ToolName
  /** The arguments, or how to work them out from the cart as it is when the preset runs. */
  args: Args | ((inCart: Quantities) => Args)
  /** Runs only on an empty cart. With items in it, checkout would leave for Stripe. */
  needsEmptyCart?: boolean
}

// What the Classic Cheeseburger goes with, read from menu.json as the agent
// reads it. A sized pairing gets the size menu cards start on.
const cheeseburger = findItem('classic-cheeseburger')
const pairings: ItemQuantity[] = (cheeseburger?.pairsWith ?? []).flatMap((id) => {
  const item = findItem(id)
  return item ? [{ id: defaultVariant(item).id, quantity: 1 }] : []
})
const pairingsTitle = `Goes great with the ${cheeseburger?.name ?? 'cheeseburger'}`

// The owner's group from their voice run, where the agent planned about twice
// the food, and the party of 20 from step 5's Check: plan_group_order works
// each out from menu.json. Each one's Add all of that plans it again for the
// cart as it is then, as the handler did (the plan leaves room for what's in
// the cart), so it adds the lines on the card, which closes, as it does for
// "add all of that" by voice.
const partyOf30: GroupOrderRequest = { people: 30, vegetarians: 10 }
const partyOf20: GroupOrderRequest = { people: 20 }

function addAllOf(party: GroupOrderRequest): (inCart: Quantities) => Args {
  return (inCart) => {
    const plan = planGroupOrder(party, inCart)
    return { items: 'lines' in plan ? plan.lines : [] }
  }
}

const presetGroups: Array<{ title: string; note: string; presets: Preset[] }> = [
  {
    title: 'Golden path',
    note: "Run them in order. Check out returns { ok: true } and goes straight to Stripe's test checkout: with voice, it will wait for the agent to finish speaking first. Without step 1 it asks for pickup or delivery instead.",
    presets: [
      { label: '1. Delivery, please', tool: 'set_order_type', args: { type: 'delivery' } },
      { label: "2. What's vegetarian?", tool: 'find_menu_items', args: { tags: ['vegetarian'] } },
      { label: '3. Add two large margheritas', tool: 'add_item', args: { id: 'margherita-pizza-large', quantity: 2 } },
      { label: '4. Make that one', tool: 'set_quantity', args: { id: 'margherita-pizza-large', quantity: 1 } },
      { label: "5. What's my total?", tool: 'view_cart', args: {} },
      { label: '6. Check out', tool: 'checkout', args: {} },
    ],
  },
  {
    title: 'Suggestions',
    note: 'They open the suggestion card. Only Add all of that changes the cart: it adds the plan above it, as planned for the cart now.',
    presets: [
      {
        label: `What goes with the ${cheeseburger?.name ?? 'cheeseburger'}?`,
        tool: 'show_suggestions',
        args: { title: pairingsTitle, items: pairings },
      },
      { label: 'Party of 30, 10 vegetarian', tool: 'plan_group_order', args: partyOf30 },
      { label: 'Add all of that (30)', tool: 'add_items', args: addAllOf(partyOf30) },
      { label: 'Party of 20', tool: 'plan_group_order', args: partyOf20 },
      { label: 'Add all of that (20)', tool: 'add_items', args: addAllOf(partyOf20) },
    ],
  },
  {
    title: 'Recovery',
    note: 'Calls the agent can get wrong. Each answers with a { message } it can act on. The last needs an empty cart, so empty it first.',
    presets: [
      { label: 'A hawaiian (not on the menu)', tool: 'add_item', args: { id: 'hawaiian-pizza', quantity: 1 } },
      { label: 'A pepperoni (no size)', tool: 'add_item', args: { id: 'pepperoni-pizza', quantity: 1 } },
      { label: 'Remove the fries (none in the cart)', tool: 'remove_item', args: { id: 'fries' } },
      { label: 'Empty the cart', tool: 'clear_cart', args: {} },
      { label: 'Check out (empty cart)', tool: 'checkout', args: {}, needsEmptyCart: true },
    ],
  },
]

// What the arguments box holds when a tool is picked from the list.
const examples: Record<ToolName, Args> = {
  find_menu_items: { tags: ['vegetarian'] },
  show_suggestions: { title: pairingsTitle, items: pairings },
  plan_group_order: { people: 12, vegetarians: 3, preferences: { mains: 'mix', spicy: true } },
  add_item: { id: 'margherita-pizza-large', quantity: 2 },
  add_items: { items: [{ id: 'fries', quantity: 1 }, { id: 'soda', quantity: 2 }] },
  set_quantity: { id: 'margherita-pizza-large', quantity: 1 },
  remove_item: { id: 'margherita-pizza-large' },
  view_cart: {},
  clear_cart: {},
  set_order_type: { type: 'delivery' },
  checkout: {},
}

/** The last run: still running, its result, or why it didn't run. */
type Outcome = { tool: ToolName; result?: ToolResult; error?: string }

const formatArgs = (args: Args) => JSON.stringify(args, null, 2)

export default function ToolsPanel({ updates }: { updates: LoggedUpdate[] }) {
  const handlers = useToolHandlers()
  const cartChanges = useCartChanges()
  const cartIsEmpty = useShoppingCart((cart) => cart.cartCount === 0)
  const [open, setOpen] = useState(true)
  const [tool, setTool] = useState<ToolName>('find_menu_items')
  const [argsText, setArgsText] = useState(() => formatArgs(examples.find_menu_items))
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const lastRun = useRef(0)
  const resultRef = useRef<HTMLElement>(null)
  const bodyId = useId()
  const definition = toolDefinitions.find((candidate) => candidate.name === tool)

  async function run(name: ToolName, text: string) {
    const runId = ++lastRun.current
    try {
      JSON.parse(text)
    } catch (error) {
      setOutcome({ tool: name, error: `The arguments aren't valid JSON. ${(error as Error).message}` })
      return
    }
    setOutcome({ tool: name })
    // The arguments go in as the JSON string Deepgram delivers a function call's arguments in.
    const result = await handlers[name](text)
    // A slow call (checkout) can finish after a newer one started. Show only the newest.
    if (runId === lastRun.current) setOutcome({ tool: name, result })
  }

  function pickTool(name: string) {
    const picked = toolDefinitions.find((candidate) => candidate.name === name)
    if (!picked) return
    setTool(picked.name)
    setArgsText(formatArgs(examples[picked.name]))
  }

  function runPreset(preset: Preset) {
    const text = formatArgs(typeof preset.args === 'function' ? preset.args(cartChanges.now()) : preset.args)
    setTool(preset.tool)
    setArgsText(text)
    run(preset.tool, text)
  }

  // On a phone the result can be below the fold of the sheet: bring it into view.
  useEffect(() => {
    if (outcome) resultRef.current?.scrollIntoView({ block: 'nearest' })
  }, [outcome])

  return (
    <aside className="tools-panel" data-open={open || undefined} aria-label="Dev tools">
      <h2 className="tools-panel-heading">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          Dev tools <span aria-hidden="true">{open ? '▾' : '▴'}</span>
        </button>
      </h2>

      <div className="tools-panel-body" id={bodyId} hidden={!open}>
        <SessionLogSection open={open} />

        <p className="tools-panel-note">
          Runs the voice agent&apos;s tools through the page&apos;s own handlers, exactly as the agent&apos;s tool calls
          would.
        </p>

        {presetGroups.map((group) => (
          <section key={group.title} className="tools-panel-section">
            <h3>{group.title}</h3>
            <p className="tools-panel-note">{group.note}</p>
            <div className="tools-panel-buttons">
              {group.presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  disabled={preset.needsEmptyCart && !cartIsEmpty}
                  onClick={() => runPreset(preset)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        ))}

        <form
          className="tools-panel-section"
          onSubmit={(event) => {
            event.preventDefault()
            run(tool, argsText)
          }}
        >
          <h3>Call a tool</h3>
          <label>
            Tool
            <select value={tool} onChange={(event) => pickTool(event.target.value)}>
              {toolDefinitions.map(({ name }) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p className="tools-panel-note">{definition?.description}</p>
          <label>
            Arguments (JSON)
            <textarea
              rows={6}
              spellCheck={false}
              value={argsText}
              onChange={(event) => setArgsText(event.target.value)}
            />
          </label>
          <button type="submit" className="tools-panel-run">
            Run
          </button>
        </form>

        <section className="tools-panel-section" ref={resultRef}>
          <h3>Result</h3>
          {outcome === null ? (
            <p className="tools-panel-note">Run a tool to see what it returns to the agent.</p>
          ) : outcome.error ? (
            <p className="tools-panel-error" role="status">
              {outcome.error}
            </p>
          ) : (
            <>
              <p role="status">
                <code>{outcome.tool}</code> {outcome.result ? 'returned:' : 'is running…'}
              </p>
              {outcome.result && <pre className="tools-panel-json">{JSON.stringify(outcome.result, null, 2)}</pre>}
            </>
          )}
        </section>

        <section className="tools-panel-section">
          <h3>Updates sent to the agent</h3>
          <p className="tools-panel-note">
            Each goes to the agent with UpdatePrompt while a voice session is on, and is logged here with a session
            or without. Tap Add on a menu card, − or + or Remove or Pickup or Delivery in the cart, or Add or Add all
            on the suggestion card.
          </p>
          {updates.length === 0 ? (
            <p>None yet.</p>
          ) : (
            <ol className="tools-panel-log">
              {updates.map((update) => (
                <li key={update.id}>
                  <time dateTime={update.time.toISOString()}>{update.time.toLocaleTimeString()}</time>
                  {update.text}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </aside>
  )
}
