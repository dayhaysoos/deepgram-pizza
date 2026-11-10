import { describe, expect, it } from 'vitest'
import { toolDefinitions } from '../agent/tools'
import { activityLabel, THINKING, TOOL_ACTIVITY } from './AgentActivity'
import type { LiveSession, LiveStatus, SessionState } from './sessionStatus'

/** A session that's on, with this status and these tool calls. */
function session(status: LiveStatus, toolCalls?: string[]): SessionState {
  const state: LiveSession = { status, sessionNumber: 1, settingsApplied: true, microphoneOn: true }
  return toolCalls ? { ...state, toolCalls } : state
}

describe('activityLabel', () => {
  it('says the agent is thinking', () => {
    expect(activityLabel(session('thinking'))).toBe('Thinking…')
  })

  it("says what each tool does while it's running", () => {
    expect(activityLabel(session('thinking', ['find_menu_items']))).toBe('Searching the menu…')
    expect(activityLabel(session('thinking', ['show_suggestions']))).toBe('Putting suggestions together…')
    expect(activityLabel(session('thinking', ['add_items']))).toBe('Adding to your cart…')
    expect(activityLabel(session('thinking', ['remove_item']))).toBe('Updating your cart…')
    expect(activityLabel(session('thinking', ['view_cart']))).toBe('Checking your cart…')
    expect(activityLabel(session('thinking', ['checkout']))).toBe('Starting checkout…')
  })

  it('has a label for every tool', () => {
    for (const { name } of toolDefinitions) expect(TOOL_ACTIVITY[name]).toMatch(/…$/)
  })

  // The browser runs a request's tools in order, so the first is the one running first.
  it('says what the first tool does when the agent asks for several', () => {
    expect(activityLabel(session('thinking', ['view_cart', 'add_item']))).toBe('Checking your cart…')
  })

  it('skips names that are not our tools, and says thinking with none left', () => {
    expect(activityLabel(session('thinking', ['lookup_weather', 'add_item']))).toBe('Adding to your cart…')
    expect(activityLabel(session('listening', ['lookup_weather']))).toBe(THINKING)
  })

  // The agent may say a few words ("Let me look.") before it asks for a tool;
  // once they've played, the SDK's mode goes back to listening.
  it('keeps saying what the tool does after the words before it', () => {
    expect(activityLabel(session('listening', ['find_menu_items']))).toBe('Searching the menu…')
  })

  it('says nothing while the customer has the floor', () => {
    expect(activityLabel(session('listening'))).toBeUndefined()
  })

  it('says nothing while the agent speaks, or the session connects', () => {
    expect(activityLabel(session('speaking', ['find_menu_items']))).toBeUndefined()
    expect(activityLabel(session('connecting'))).toBeUndefined()
  })

  it('says nothing without a session', () => {
    expect(activityLabel({ status: 'idle', sessionNumber: 1, endedBy: 'pressed' })).toBeUndefined()
    expect(activityLabel({ status: 'error', sessionNumber: 1, message: 'No.', endedBy: 'agentError' })).toBeUndefined()
  })
})
