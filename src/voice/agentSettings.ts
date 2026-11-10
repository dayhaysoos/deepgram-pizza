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
// To change the voice, pick another `flux-…-en` voice from the catalog above.

import type { AgentSettingsObject } from '@deepgram/react'
import type { CartSummary } from '../agent/cartSummary'
import { agentInstructions, GREETING } from '../agent/instructions'
import type { ToolDefinition } from '../agent/tools'

/** Deepgram's limit on `think.prompt` for managed LLMs, in characters. */
export const MANAGED_PROMPT_LIMIT = 25_000

/**
 * The agent's settings for a session that starts with this cart and can call
 * these tools: pass `summarizeCart(quantitiesOf(cartDetails))`, read when the
 * customer presses the talk button, and the tools the browser handles (none
 * in step 4, `toolDefinitions` from step 5).
 */
export function agentSettings(cart: CartSummary, tools: readonly ToolDefinition[] = []): AgentSettingsObject {
  return {
    listen: {
      provider: { type: 'deepgram', version: 'v2', model: 'flux-general-en' },
    },
    think: {
      provider: { type: 'open_ai', model: 'gpt-4.1-mini' },
      prompt: agentInstructions(cart, tools),
      // A session without tools sends no `functions` at all, rather than an
      // empty list, so it's the same request step 4 was tested with.
      ...(tools.length > 0 ? { functions: [...tools] } : {}),
    },
    speak: {
      provider: { type: 'deepgram', version: 'v2', model: 'flux-cole-en' },
    },
    greeting: GREETING,
  }
}
