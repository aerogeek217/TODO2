import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { settingsRepository } from '../../data/settings-repository'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('settingsRepository', () => {
  it('put + getAll stores key-value pairs', async () => {
    await settingsRepository.put('theme', 'dark')
    await settingsRepository.put('language', 'en')

    const all = await settingsRepository.getAll()
    expect(all).toHaveLength(2)
    expect(all.find(s => s.key === 'theme')!.value).toBe('dark')
    expect(all.find(s => s.key === 'language')!.value).toBe('en')
  })

  it('put overwrites existing key', async () => {
    await settingsRepository.put('theme', 'dark')
    await settingsRepository.put('theme', 'light')

    const all = await settingsRepository.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].value).toBe('light')
  })

  it('delete removes a key', async () => {
    await settingsRepository.put('theme', 'dark')
    await settingsRepository.delete('theme')

    const all = await settingsRepository.getAll()
    expect(all).toHaveLength(0)
  })

  it('bulkDelete removes multiple keys', async () => {
    await settingsRepository.put('a', '1')
    await settingsRepository.put('b', '2')
    await settingsRepository.put('c', '3')

    await settingsRepository.bulkDelete(['a', 'c'])
    const all = await settingsRepository.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].key).toBe('b')
  })
})
