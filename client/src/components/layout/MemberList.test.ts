import { describe, expect, it } from 'vitest';
import { resolveMemberStatus } from './MemberList';

describe('resolveMemberStatus', () => {
  it('prefers explicit presence status when available', () => {
    expect(resolveMemberStatus('idle', false, false)).toBe('idle');
  });

  it('marks authenticated self member as online when presence is missing', () => {
    expect(resolveMemberStatus(undefined, false, true)).toBe('online');
  });

  it('marks in-voice members as online when presence is missing', () => {
    expect(resolveMemberStatus(undefined, true, false)).toBe('online');
  });

  it('falls back to offline when no signals indicate online', () => {
    expect(resolveMemberStatus(undefined, false, false)).toBe('offline');
  });
});
