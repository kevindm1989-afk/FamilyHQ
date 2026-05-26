/**
 * PLACEHOLDER firestore.rules test suite.
 *
 * The REAL security-rules tests are Task 5 (Phase 1), authored by the
 * test-writer + implementer. They must cover (from system-design §2.4 / §6):
 *   - cross-tenant read/list/write DENIED (F1, the worst failure mode)
 *   - member cannot self-set role=parent (F2)
 *   - user cannot change own familyId (F2)
 *   - isActive:false denied all ops (F3)
 *   - member writes only own chore + only pending->complete
 *   - signup self-create cannot flip an existing member or create a 2nd family
 *
 * This file exists ONLY so `npm run test:rules` and the CI `firestore-rules`
 * job are wired now and run against the emulator. It does not assert real
 * rules behavior yet. @firebase/rules-unit-testing is installed and ready.
 */
describe('firestore.rules (placeholder — real suite is Task 5)', () => {
  it('placeholder spec runs under the emulator harness', () => {
    expect(true).toBe(true);
  });
});
