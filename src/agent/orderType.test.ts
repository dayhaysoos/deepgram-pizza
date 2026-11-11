import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSavedOrderType, createOrderTypeStore, describeOrderType, ORDER_TYPE_KEY, type OrderTypeStorage } from './orderType'

afterEach(() => {
  vi.restoreAllMocks()
})

/** localStorage as the store sees it, kept in a Map. */
function fakeStorage(saved: Record<string, string> = {}) {
  const items = new Map(Object.entries(saved))
  const storage: OrderTypeStorage = {
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
    removeItem: vi.fn((key: string) => void items.delete(key)),
  }
  return { storage, items }
}

/** Storage that throws on every call, as a browser with storage blocked can. */
const blockedStorage: OrderTypeStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
}

describe('createOrderTypeStore', () => {
  it('starts with no choice when nothing is saved', () => {
    expect(createOrderTypeStore(fakeStorage().storage).get()).toBeNull()
  })

  it('records a choice and saves it, so a reload gets it back', () => {
    const { storage, items } = fakeStorage()
    const store = createOrderTypeStore(storage)

    store.set('delivery')

    expect(store.get()).toBe('delivery')
    expect(items.get(ORDER_TYPE_KEY)).toBe('delivery')
    expect(createOrderTypeStore(storage).get()).toBe('delivery')
  })

  it('changes its mind', () => {
    const { storage, items } = fakeStorage({ [ORDER_TYPE_KEY]: 'delivery' })
    const store = createOrderTypeStore(storage)

    store.set('pickup')

    expect(store.get()).toBe('pickup')
    expect(items.get(ORDER_TYPE_KEY)).toBe('pickup')
  })

  it('ignores a saved value that is not an order type', () => {
    expect(createOrderTypeStore(fakeStorage({ [ORDER_TYPE_KEY]: 'takeout' }).storage).get()).toBeNull()
    expect(createOrderTypeStore(fakeStorage({ [ORDER_TYPE_KEY]: '' }).storage).get()).toBeNull()
  })

  it('forgets the choice, saved copy included', () => {
    const { storage, items } = fakeStorage({ [ORDER_TYPE_KEY]: 'pickup' })
    const store = createOrderTypeStore(storage)

    store.clear()

    expect(store.get()).toBeNull()
    expect(items.has(ORDER_TYPE_KEY)).toBe(false)
    expect(createOrderTypeStore(storage).get()).toBeNull()
  })

  it('tells its listeners about each change, and only about changes', () => {
    const store = createOrderTypeStore(fakeStorage().storage)
    const listener = vi.fn()
    const stop = store.subscribe(listener)

    store.set('delivery')
    store.set('delivery')
    store.set('pickup')
    store.clear()
    store.clear()
    expect(listener).toHaveBeenCalledTimes(3)

    stop()
    store.set('delivery')
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('works for the page without storage (on the server, or with storage blocked), and never throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const storage of [null, blockedStorage]) {
      const store = createOrderTypeStore(storage)
      expect(store.get()).toBeNull()
      store.set('pickup')
      expect(store.get()).toBe('pickup')
      store.clear()
      expect(store.get()).toBeNull()
    }
  })

  it('has no browser storage in Node, so by default it keeps the choice in memory', () => {
    const store = createOrderTypeStore()
    store.set('delivery')
    expect(store.get()).toBe('delivery')
  })
})

describe('clearSavedOrderType', () => {
  it('forgets the saved choice, as the order page does with the cart once the customer has paid', () => {
    const { storage } = fakeStorage({ [ORDER_TYPE_KEY]: 'delivery' })

    clearSavedOrderType(storage)

    expect(createOrderTypeStore(storage).get()).toBeNull()
  })

  it('never throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => clearSavedOrderType(blockedStorage)).not.toThrow()
    expect(() => clearSavedOrderType(null)).not.toThrow()
    expect(() => clearSavedOrderType()).not.toThrow()
  })
})

describe('describeOrderType', () => {
  it("says the choice the way the agent's instructions and the tap updates do", () => {
    expect(describeOrderType('delivery')).toBe('Order type: delivery.')
    expect(describeOrderType('pickup')).toBe('Order type: pickup.')
    expect(describeOrderType(null)).toBe('Order type: not chosen yet.')
  })
})
