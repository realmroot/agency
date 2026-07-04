import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { server } from './msw'

// jsdom has no matchMedia; the console layout reads it.
function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  stubMatchMedia()
  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  })
  Object.defineProperty(globalThis, 'CustomEvent', {
    writable: true,
    configurable: true,
    value: window.CustomEvent,
  })
  // Any /api/v1 request a test forgot to handle is a real gap — fail loudly.
  server.listen({ onUnhandledRequest: 'error' })
})

beforeEach(() => {
  // The api client's e2e fast-path reads these; every web test is "signed in" by
  // default so the real client attaches auth + project headers.
  window.localStorage.setItem('ama:e2e-access-token', 'e2e:web-test')
  window.localStorage.setItem('ama:selected-project-id', 'project_test')
})

afterEach(() => {
  server.resetHandlers()
  cleanup()
  window.localStorage.clear()
})

afterAll(() => server.close())
