import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('platform utils', () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.Capacitor;
  });

  it('returns false when Capacitor is not present', async () => {
    const { isNativeApp } = await import('../utils/platform.js');
    expect(isNativeApp()).toBe(false);
  });

  it('returns true when Capacitor.isNativePlatform() is true', async () => {
    window.Capacitor = { isNativePlatform: () => true };
    const { isNativeApp } = await import('../utils/platform.js');
    expect(isNativeApp()).toBe(true);
  });

  it('returns false when Capacitor.isNativePlatform() is false (web build of Capacitor)', async () => {
    window.Capacitor = { isNativePlatform: () => false };
    const { isNativeApp } = await import('../utils/platform.js');
    expect(isNativeApp()).toBe(false);
  });
});
