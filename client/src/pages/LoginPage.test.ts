import { describe, expect, it } from 'vitest';
import { resolveLoginIdentifierMode } from './LoginPage';

describe('resolveLoginIdentifierMode', () => {
  it('allows username input when server explicitly allows username login', () => {
    const mode = resolveLoginIdentifierMode(true, true);
    expect(mode.allowUsernameInput).toBe(true);
    expect(mode.inputType).toBe('text');
    expect(mode.label).toBe('Email or Username');
  });

  it('allows username input when email is optional', () => {
    const mode = resolveLoginIdentifierMode(false, false);
    expect(mode.allowUsernameInput).toBe(true);
    expect(mode.inputType).toBe('text');
    expect(mode.placeholder).toContain('username');
  });

  it('requires email-only input when username login is disabled and email is required', () => {
    const mode = resolveLoginIdentifierMode(false, true);
    expect(mode.allowUsernameInput).toBe(false);
    expect(mode.inputType).toBe('email');
    expect(mode.label).toBe('Email');
  });
});
