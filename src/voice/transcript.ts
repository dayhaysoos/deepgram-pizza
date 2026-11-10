// The conversation of the latest voice session, kept for the page. The
// captions show its latest exchange, and their "Show conversation" toggle all
// of it (Captions.tsx). AgentProvider keeps the conversation only while its
// session is on, so VoiceSession keeps a copy that outlives it: it stays after
// the session ends, until a press starts the next session, which starts a new
// transcript.

import type { ConversationEntry } from '@deepgram/react'

/** One line of the conversation: who said it, what they said, and its id, which stays the same. */
export type TranscriptLine = Pick<ConversationEntry, 'id' | 'role' | 'content'>

/** Session number `sessionNumber`'s lines, oldest first. */
export type Transcript = { sessionNumber: number; lines: readonly TranscriptLine[] }

/** The page's first render: no session, no lines. */
export const NO_TRANSCRIPT: Transcript = { sessionNumber: 0, lines: [] }

/**
 * The transcript after `next`, a session's conversation as its AgentProvider
 * has it now: it replaces an earlier session's, and the same session's older
 * one. An earlier session's changes nothing. Returns `transcript` itself when
 * nothing changes.
 */
export function updateTranscript(transcript: Transcript, next: Transcript): Transcript {
  if (next.sessionNumber < transcript.sessionNumber) return transcript
  if (next.sessionNumber === transcript.sessionNumber && next.lines === transcript.lines) return transcript
  return next
}

/**
 * The lines to show while session number `sessionNumber` is the latest, live
 * or ended. A press that starts a session moves to a new number, so the last
 * session's lines go at once, before the new session has a conversation.
 */
export function sessionLines(transcript: Transcript, sessionNumber: number): readonly TranscriptLine[] {
  return transcript.sessionNumber === sessionNumber ? transcript.lines : []
}
