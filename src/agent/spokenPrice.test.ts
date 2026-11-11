import { describe, expect, it } from 'vitest'
import { products } from '../menu/menu'
import { MAX_LINE_QUANTITY } from '../shop'
import { numberWords, spokenPrice } from './spokenPrice'

describe('spokenPrice', () => {
  it('says a price under a hundred dollars the way a counter worker does', () => {
    expect(spokenPrice(2099)).toBe('twenty ninety-nine')
    expect(spokenPrice(1899)).toBe('eighteen ninety-nine')
    expect(spokenPrice(9999)).toBe('ninety-nine ninety-nine')
    expect(spokenPrice(1011)).toBe('ten eleven')
    expect(spokenPrice(150)).toBe('one fifty')
    expect(spokenPrice(199)).toBe('one ninety-nine')
  })

  it('says cents under ten with "oh", as people do', () => {
    expect(spokenPrice(405)).toBe('four oh five')
    expect(spokenPrice(2001)).toBe('twenty oh one')
  })

  it('says whole dollars, and cents alone, with their unit', () => {
    expect(spokenPrice(2000)).toBe('twenty dollars')
    expect(spokenPrice(2100)).toBe('twenty-one dollars')
    expect(spokenPrice(100)).toBe('one dollar')
    expect(spokenPrice(10_000)).toBe('one hundred dollars')
    expect(spokenPrice(99)).toBe('ninety-nine cents')
    expect(spokenPrice(1)).toBe('one cent')
    expect(spokenPrice(0)).toBe('zero dollars')
  })

  // "two ninety-seven fifty-six" (what the agent said in the owner's run) runs three numbers together.
  it('says dollars and cents from a hundred dollars up, so a listener can tell where the dollars end', () => {
    expect(spokenPrice(18_071)).toBe('one hundred eighty dollars and seventy-one cents')
    expect(spokenPrice(29_756)).toBe('two hundred ninety-seven dollars and fifty-six cents')
    expect(spokenPrice(10_001)).toBe('one hundred dollars and one cent')
    expect(spokenPrice(123_405)).toBe('one thousand two hundred thirty-four dollars and five cents')
  })

  it('has only words in it, for every price on the menu and the biggest line a cart holds', () => {
    for (const { price } of products) {
      for (const cents of [price, price * MAX_LINE_QUANTITY]) {
        expect(spokenPrice(cents), String(cents)).toMatch(/^[a-z]+(?:[ -][a-z]+)*$/)
      }
    }
  })
})

describe('numberWords', () => {
  it('writes a whole number in words, without "and"', () => {
    expect(numberWords(0)).toBe('zero')
    expect(numberWords(13)).toBe('thirteen')
    expect(numberWords(40)).toBe('forty')
    expect(numberWords(42)).toBe('forty-two')
    expect(numberWords(100)).toBe('one hundred')
    expect(numberWords(305)).toBe('three hundred five')
    expect(numberWords(1000)).toBe('one thousand')
    expect(numberWords(21_017)).toBe('twenty-one thousand seventeen')
    expect(numberWords(1_250_000)).toBe('one million two hundred fifty thousand')
  })
})
