import { describe, expect, test } from 'vitest';
import { readinessStatus } from '../renderer/Services/ReadinessSemantics';

describe('readiness semantics', () => {
  test('reserves the checkmark for verified facts', () => {
    expect(readinessStatus(true)).toBe('verified');
    expect(readinessStatus(false)).toBe('unknown');
    expect(readinessStatus(false, true)).toBe('problem');
    expect(readinessStatus(true, true)).toBe('problem');
  });
});
