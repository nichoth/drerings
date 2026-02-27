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

Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn()
})

Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query:string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
    }))
})
