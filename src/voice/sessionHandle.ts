// What code that lives as long as the page can ask of the voice session,
// whether or not one is on: tell the agent something (tap updates), leave
// once the agent has spoken (checkout by voice), and show something once the
// agent's voice has started (the suggestion card and the highlights).
// VoiceSessionProvider makes one handle for the page; the live session hands
// it its AgentSession, and the reducer (sessionStatus.ts) decides when a leave
// is over. No React or SDK code here, so tests drive it with plain functions
// and fake timers.

import { isLive, NO_SESSION, type SessionEvent, type SessionState } from './sessionStatus'

/**
 * The longest a leave waits for the agent to finish speaking. The checkout
 * line alone ("Taking you to checkout now so you can pay forty-five
 * ninety-seven and enter your delivery address.") takes a few seconds, but the
 * agent can read the order back first in the same reply: in the voice check
 * of checkout paths (.build/step-5b.md) the 10 s cap this used to be fired
 * during the line and the redirect cut it short. If no reply comes, or an
 * event is lost, the customer still gets to checkout.
 */
export const LEAVE_CAP_MS = 20_000

/**
 * How long the agent's voice plays before what a tool showed comes up: the
 * voice leads and the picture follows, like a film's sound running a moment
 * ahead of its cut. The owner found the card popping up in silence before
 * the agent spoke disjointed (2026-11-11).
 */
export const VOICE_LEAD_MS = 400

/** The longest something waits for the agent's voice, so a reply that's slow, or never comes, doesn't hide it. */
export const SHOW_CAP_MS = 2_000

/** The part of the SDK's AgentSession the handle talks to. */
export type PromptTarget = { updatePrompt(prompt: string): void }

/** What page code can ask of the voice session. Safe to call when no session is on. */
export type SessionHandle = {
  /**
   * Tells the agent `text` by adding it to its prompt (Deepgram's
   * UpdatePrompt, which the agent reads without replying). Does nothing when
   * no session is on. Before the agent has its settings, and after a
   * reconnect, the SDK sends only the newest text, so each one has to say
   * everything the agent needs: tap updates carry the whole cart.
   */
  tell(text: string): void
  /**
   * Ends the session once the agent's voice next stops, and resolves when it
   * has ended. Resolves at once when no session is on, and after LEAVE_CAP_MS
   * at the latest.
   */
  leaveAfterSpeaking(): Promise<void>
  /**
   * Calls `show` once the agent's voice has played for VOICE_LEAD_MS, for
   * what a tool puts on screen while the agent's reply is on its way: the
   * card comes up with "Let me put something together.", not before it. At
   * once when no session is on, or once the session ends; after SHOW_CAP_MS
   * at the latest. Returns the function that cancels it, for something
   * replaced before it showed.
   */
  showWithVoice(show: () => void): () => void
}

/** The handle, plus what VoiceSessionProvider and the live session keep it up to date with. */
export type SessionHandleControls = SessionHandle & {
  /** The session's state, after every change. */
  update(state: SessionState): void
  /** The live session's AgentSession, once its provider has made it. Returns the function to call when it's gone. */
  attach(agent: PromptTarget): () => void
}

/** Creates the page's handle. `send` passes events to the session's reducer. */
export function createSessionHandle(send: (event: SessionEvent) => void): SessionHandleControls {
  let state: SessionState = NO_SESSION
  let agent: PromptTarget | null = null
  /** Leaves waiting for their session to end. */
  const leaves = new Set<{ sessionNumber: number; done: () => void }>()
  /** What's waiting to show: `voiceStarted` starts its lead, `now` shows it. */
  const shows = new Set<{ voiceStarted: () => void; now: () => void }>()

  return {
    tell(text) {
      if (agent && isLive(state)) agent.updatePrompt(text)
    },

    leaveAfterSpeaking() {
      if (!isLive(state)) return Promise.resolve()
      const { sessionNumber } = state
      send({ type: 'leaveRequested', sessionNumber })
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          send({ type: 'leaveTimedOut', sessionNumber })
          leave.done()
        }, LEAVE_CAP_MS)
        const leave = {
          sessionNumber,
          done() {
            clearTimeout(timer)
            leaves.delete(leave)
            resolve()
          },
        }
        leaves.add(leave)
      })
    },

    showWithVoice(show) {
      if (!isLive(state)) {
        show()
        return () => {}
      }
      let lead: ReturnType<typeof setTimeout> | undefined
      const cap = setTimeout(() => waiting.now(), SHOW_CAP_MS)
      const cancel = () => {
        clearTimeout(cap)
        clearTimeout(lead)
        shows.delete(waiting)
      }
      const waiting = {
        voiceStarted() {
          lead ??= setTimeout(() => waiting.now(), VOICE_LEAD_MS)
        },
        now() {
          cancel()
          show()
        },
      }
      shows.add(waiting)
      if (state.status === 'speaking') waiting.voiceStarted()
      return cancel
    },

    update(next) {
      state = next
      for (const leave of leaves) {
        if (!isLive(next) || next.sessionNumber !== leave.sessionNumber) leave.done()
      }
      for (const waiting of shows) {
        if (!isLive(next)) waiting.now()
        else if (next.status === 'speaking') waiting.voiceStarted()
      }
    },

    attach(next) {
      agent = next
      return () => {
        // A session that has gone can't take the next one's agent with it.
        if (agent === next) agent = null
      }
    },
  }
}
