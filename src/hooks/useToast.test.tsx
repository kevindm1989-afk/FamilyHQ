/**
 * useToast — queue + auto-dismiss contract (Task 7, style-guide §Toast).
 *
 * Level: unit (RTL + fake timers — NO real clock, determinism rule). Asserts:
 * showToast makes a message visible; it auto-dismisses after TOAST_DURATION_MS;
 * dismiss clears it immediately.
 *
 * FAILS today: ToastProvider/useToast are declare-only contract stubs.
 */
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { TOAST_DURATION_MS, ToastProvider, useToast } from './useToast';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  // Drain the toast's auto-dismiss timer (which calls setMessage(null) on
  // the ToastProvider) INSIDE an act() boundary. Without the wrap, the
  // setState that fires when the timer flushes lands outside act and React
  // logs an "update to ToastProvider inside a test was not wrapped in
  // act(...)" warning — once per test that scheduled a timer.
  act(() => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
});

describe('useToast', () => {
  it('starts with no visible toast', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    expect(result.current.message).toBeNull();
  });

  it('shows a queued message', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.showToast('Saved'));
    expect(result.current.message).toBe('Saved');
  });

  it('auto-dismisses after TOAST_DURATION_MS', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.showToast('Marked complete'));
    expect(result.current.message).toBe('Marked complete');

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(result.current.message).toBeNull();
  });

  it('does NOT dismiss before the full duration elapses', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.showToast('Still here'));
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(result.current.message).toBe('Still here');
  });

  it('dismiss() clears the toast immediately', () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    act(() => result.current.showToast('Bye'));
    act(() => result.current.dismiss());
    expect(result.current.message).toBeNull();
  });

  it('throws when used outside a ToastProvider', () => {
    // Rendering a consumer with no provider must fail loudly, not silently
    // return a no-op (so a missing provider is caught in dev).
    const Consumer = () => {
      useToast();
      return null;
    };
    expect(() => render(<Consumer />)).toThrow();
  });
});
