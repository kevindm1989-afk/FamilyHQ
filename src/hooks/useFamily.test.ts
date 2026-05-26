/**
 * Family derivation — unit contract (Task 7, system-design §2.6).
 *
 * Level: unit (pure derivation; no live Firestore). Asserts the AC: the
 * dynamic family list exposes ONLY active members of the caller's family —
 * never cross-family, never deactivated.
 *
 * FAILS today: deriveActiveMembers is a declare-only contract stub.
 */
import { describe, expect, it } from 'vitest';
import { deriveActiveMembers } from './useFamily';
import type { UserWithId } from '../lib/types';

const mk = (
  id: string,
  familyId: string,
  isActive: boolean,
  role: 'parent' | 'member' = 'member',
): UserWithId => ({
  id,
  name: id,
  email: `${id}@example.test`,
  role,
  familyId,
  isActive,
  allowanceBalance: 0,
  theme: 'light',
});

const ALL: UserWithId[] = [
  mk('parent-a', 'fam-A', true, 'parent'),
  mk('member-a1', 'fam-A', true),
  mk('member-a2', 'fam-A', true),
  mk('deactivated-a', 'fam-A', false),
  mk('parent-b', 'fam-B', true, 'parent'),
  mk('member-b1', 'fam-B', true),
];

describe('deriveActiveMembers', () => {
  it('returns only members of the requested family', () => {
    const result = deriveActiveMembers(ALL, 'fam-A');
    expect(result.every((u) => u.familyId === 'fam-A')).toBe(true);
    expect(result.find((u) => u.id === 'member-b1')).toBeUndefined();
  });

  it('excludes deactivated members (isActive:false)', () => {
    const result = deriveActiveMembers(ALL, 'fam-A');
    expect(result.find((u) => u.id === 'deactivated-a')).toBeUndefined();
  });

  it('includes active parents AND active members of the family', () => {
    const ids = deriveActiveMembers(ALL, 'fam-A')
      .map((u) => u.id)
      .sort();
    expect(ids).toEqual(['member-a1', 'member-a2', 'parent-a']);
  });

  it('returns an empty list for a family with no active users', () => {
    const onlyDeactivated = [mk('x', 'fam-Z', false)];
    expect(deriveActiveMembers(onlyDeactivated, 'fam-Z')).toEqual([]);
  });

  it('never leaks another family even when familyIds collide by prefix', () => {
    const tricky = [mk('a', 'fam-A', true), mk('a10', 'fam-A10', true)];
    const result = deriveActiveMembers(tricky, 'fam-A');
    expect(result.map((u) => u.id)).toEqual(['a']);
  });
});
