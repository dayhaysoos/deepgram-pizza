// The voice agent's settings: the models that listen, think and speak, the
// tools it can call, plus the instructions and greeting from
// src/agent/instructions.ts. The session sends them once, as soon as it
// connects. Like instructions.ts, this module has no React or SDK code in it
// (only types), so evals can import it.
//
// One tool list feeds both `think.functions` and the instructions, so the
// prompt only tells the agent to use tools it can actually call.
//
// The models follow Deepgram's docs (checked 2026-11-10):
// - Listen: Flux, "best for low-latency voice agents", with end-of-turn
//   detection built into the model. It needs `version: 'v2'`, and takes no
//   `smart_format`. https://developers.deepgram.com/docs/voice-agent-stt-models
//   It listens for the menu's item names as keyterms (menuKeyterms below),
//   which Flux supports: https://developers.deepgram.com/docs/keyterm
// - Think: a Deepgram-managed LLM, so there's no endpoint or LLM key to set
//   up. GPT-4.1 mini answers without a reasoning step first and handles tool
//   calls well. https://developers.deepgram.com/docs/voice-agent-llm-models
// - Speak: Flux TTS, Deepgram's "streaming-first, voice-agent-first" voices,
//   which also need `version: 'v2'`. Cole is a friendly young American voice.
//   https://developers.deepgram.com/docs/voice-agent-tts-models and
//   https://developers.deepgram.com/docs/flux-tts/voices
//
// Audio formats are left to the SDK and Deepgram's defaults: the browser SDK
// sends 16 kHz linear16 and plays back the 24 kHz linear16 Flux TTS sends.
//
// To change the voice, pick another `flux-…-en` voice from the catalog above;
// to change its pace, SPEAK_SPEED below.

import type { AgentSettingsObject } from '@deepgram/react'
import type { CartSummary } from '../agent/cartSummary'
import { agentInstructions, greeting } from '../agent/instructions'
import type { ToolDefinition } from '../agent/tools'
import { menu, spokenName } from '../menu/menu'
import type { OrderType } from '../shop'

/**
 * How fast the agent speaks: 1 is the voice's own pace, and Flux TTS takes 0.5
 * to 1.5 in steps of 0.05. The owner found Cole at 1 ran the greeting's words
 * together (2026-11-16), so it's a little slower.
 * https://developers.deepgram.com/docs/voice-agent-tts-controls
 */
export const SPEAK_SPEED = 0.9

/** Deepgram's limit on `think.prompt` for managed LLMs, in characters. */
export const MANAGED_PROMPT_LIMIT = 25_000

/**
 * The agent's settings for a session that starts with this cart and
 * pickup-or-delivery choice, and can call these tools: pass
 * `summarizeCart(quantitiesOf(cartDetails), orderType)` (for delivery, with the
 * fee, which the instructions' cart line gives) and the choice (null before
 * there is one), both read when the customer presses the talk button, and the
 * tools the browser handles (none in step 4, `toolDefinitions` from step 5).
 */
export function agentSettings(
  cart: CartSummary,
  tools: readonly ToolDefinition[] = [],
  orderType: OrderType | null = null,
): AgentSettingsObject {
  return {
    listen: {
      provider: { type: 'deepgram', version: 'v2', model: 'flux-general-en', keyterms: menuKeyterms() },
    },
    think: {
      provider: { type: 'open_ai', model: 'gpt-4.1-mini' },
      prompt: agentInstructions(cart, tools, orderType),
      // A session without tools sends no `functions` at all, rather than an
      // empty list, so it's the same request step 4 was tested with.
      ...(tools.length > 0 ? { functions: [...tools] } : {}),
    },
    speak: {
      provider: { type: 'deepgram', version: 'v2', model: 'flux-cole-en', speed: SPEAK_SPEED },
    },
    greeting: greeting(orderType, tools),
  }
}

/**
 * The words Flux listens for: each item's name as people say it, from
 * menu.json ("margherita pizza", "garlic knots"). In step 5's Check it heard
 * "margaritas" for "margherita". Lower case, as Deepgram's keyterm guide says
 * for words that aren't proper nouns, and the spoken name, since "(6)" in
 * "Garlic Knots (6)" isn't something anyone says. The guide allows up to 100
 * keyterms, 500 tokens in all, and suggests 20 to 50 that matter:
 * https://developers.deepgram.com/docs/keyterm
 */
export function menuKeyterms(): string[] {
  return [...new Set(menu.map(spokenName))]
}
