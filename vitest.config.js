import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        clearMocks: true,
        restoreMocks: true,
        unstubGlobals: true,
        setupFiles: ['./test/setup.ts'],
        environmentOptions: {
            jsdom: {
                url: 'http://127.0.0.1:8888/'
            }
        }
    }
})
