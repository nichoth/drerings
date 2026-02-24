import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/preact'

afterEach(() => {
    cleanup()
    history.replaceState(null, '', '/')
})

// jsdom does not implement scroll behavior.
Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn()
})
