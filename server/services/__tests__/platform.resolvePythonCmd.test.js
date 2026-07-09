import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolvePythonCmd } from '../platform.js'

// Unit tests for resolvePythonCmd.
// Requirements: 1.2, 1.3, 1.4
//
// resolvePythonCmd reads process.env.PYTHON and process.platform at call time.
// Resolution order:
//   1. process.env.PYTHON override (if truthy)          -> Requirement 1.2
//   2. Windows (process.platform === 'win32')  -> 'python'  -> Requirement 1.3
//   3. Otherwise                               -> 'python3' -> Requirement 1.4
//
// process.platform is read-only in the normal sense, so we stub it with
// Object.defineProperty and restore the original descriptor after each test.
// process.env.PYTHON is saved and restored so other test files are unaffected.

describe('resolvePythonCmd', () => {
  let originalPlatformDescriptor
  let hadPythonEnv
  let originalPythonEnv

  function stubPlatform(value) {
    Object.defineProperty(process, 'platform', { value, configurable: true })
  }

  beforeEach(() => {
    // Save the original platform descriptor so we can restore it exactly.
    originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')

    // Save the original PYTHON env so we can restore it exactly.
    hadPythonEnv = Object.prototype.hasOwnProperty.call(process.env, 'PYTHON')
    originalPythonEnv = process.env.PYTHON

    // Start each test from a clean slate: no PYTHON override.
    delete process.env.PYTHON
  })

  afterEach(() => {
    // Restore process.platform to its original descriptor.
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }

    // Restore process.env.PYTHON to its original state.
    if (hadPythonEnv) {
      process.env.PYTHON = originalPythonEnv
    } else {
      delete process.env.PYTHON
    }
  })

  describe('when process.env.PYTHON is set (override — Requirement 1.2)', () => {
    it('returns the override value on win32', () => {
      process.env.PYTHON = '/custom/python'
      stubPlatform('win32')
      expect(resolvePythonCmd()).toBe('/custom/python')
    })

    it('returns the override value on linux', () => {
      process.env.PYTHON = '/custom/python'
      stubPlatform('linux')
      expect(resolvePythonCmd()).toBe('/custom/python')
    })

    it('returns the override value on darwin', () => {
      process.env.PYTHON = 'py -3'
      stubPlatform('darwin')
      expect(resolvePythonCmd()).toBe('py -3')
    })
  })

  describe('when PYTHON is unset and platform is win32 (Requirement 1.3)', () => {
    it("returns 'python'", () => {
      stubPlatform('win32')
      expect(resolvePythonCmd()).toBe('python')
    })
  })

  describe('when PYTHON is unset and platform is not win32 (Requirement 1.4)', () => {
    it("returns 'python3' on linux", () => {
      stubPlatform('linux')
      expect(resolvePythonCmd()).toBe('python3')
    })

    it("returns 'python3' on darwin", () => {
      stubPlatform('darwin')
      expect(resolvePythonCmd()).toBe('python3')
    })
  })
})
