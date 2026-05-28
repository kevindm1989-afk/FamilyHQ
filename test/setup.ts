// Vitest global setup for component tests.
// Adds @testing-library/jest-dom matchers (toBeInTheDocument, etc.).
import '@testing-library/jest-dom/vitest';

// Adds the a11y gate's `toHaveNoViolations` matcher (Phase 4 / Task 17).
// vitest-axe@0.1.0 ships an empty `extend-expect.js` (upstream bug) AND its
// `matchers.d.ts` re-exports `toHaveNoViolations` in a mixed-type-and-value
// export shape that TS rejects under `isolatedModules` (TS1362). We bypass
// the type chain by re-implementing the matcher locally against axe-core's
// public types — the implementation is small and stable, and this removes
// our gate from depending on vitest-axe's broken type exports.
import type { AxeResults } from 'axe-core';
import { expect } from 'vitest';

interface NoViolationsAssertion {
  toHaveNoViolations(): void;
}
declare module 'vitest' {
  // T must mirror vitest's own `Assertion<T = any>` parameter to satisfy
  // TS2428 (declarations must agree on type parameters). Empty bodies are
  // intentional — these are MODULE AUGMENTATIONS that mix our matcher into
  // the upstream interfaces; the augmentation IS the value.
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars */
  interface Assertion<T = any> extends NoViolationsAssertion {}
  interface AsymmetricMatchersContaining extends NoViolationsAssertion {}
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars */
}

expect.extend({
  toHaveNoViolations(received: AxeResults) {
    const violations = received?.violations ?? [];
    const pass = violations.length === 0;
    return {
      pass,
      actual: violations,
      message: () => {
        if (pass) return 'expected at least one a11y violation, found none';
        const lines = violations.map((v) => {
          const targets = v.nodes
            .map((n) => `      at: ${n.target.join(', ')}\n         ${n.failureSummary ?? ''}`)
            .join('\n');
          return `  - [${v.impact ?? 'unknown'}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${targets}`;
        });
        return ['expected no a11y violations, axe found:', ...lines].join('\n');
      },
    };
  },
});
