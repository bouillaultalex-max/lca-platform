import { describe, expect, it } from 'vitest';
import { validateAllocationClosureLines, type AllocationClosureInput } from './allocationClosureValidation';

function makeLine(overrides: Partial<AllocationClosureInput> = {}): AllocationClosureInput {
  return {
    allocationId: 'alloc-1',
    plannedQuantity: 100,
    producedQuantity: 100,
    rejectedQuantity: 0,
    ...overrides,
  };
}

describe('validateAllocationClosureLines', () => {
  it('returns no error when produced + rejected equals the planned quantity', () => {
    expect(validateAllocationClosureLines([makeLine({ producedQuantity: 90, rejectedQuantity: 10 })])).toEqual([]);
  });

  it('flags a line whose total does not match the planned quantity', () => {
    const errors = validateAllocationClosureLines([
      makeLine({ allocationId: 'alloc-1', producedQuantity: 80, rejectedQuantity: 10, plannedQuantity: 100 }),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].allocationId).toBe('alloc-1');
  });

  it('flags a negative produced quantity', () => {
    const errors = validateAllocationClosureLines([makeLine({ producedQuantity: -1, rejectedQuantity: 0 })]);
    expect(errors).toHaveLength(1);
    expect(errors[0].allocationId).toBe('alloc-1');
  });

  it('flags a negative rejected quantity', () => {
    const errors = validateAllocationClosureLines([makeLine({ producedQuantity: 100, rejectedQuantity: -1 })]);
    expect(errors).toHaveLength(1);
  });

  it('flags a non-integer produced quantity', () => {
    const errors = validateAllocationClosureLines([makeLine({ producedQuantity: 99.5, rejectedQuantity: 0 })]);
    expect(errors).toHaveLength(1);
  });

  it('never auto-corrects: reports the exact mismatch amount in the message', () => {
    const errors = validateAllocationClosureLines([
      makeLine({ producedQuantity: 50, rejectedQuantity: 20, plannedQuantity: 100 }),
    ]);
    expect(errors[0].message).toContain('70');
    expect(errors[0].message).toContain('100');
  });

  it('validates multiple lines independently, reporting only the invalid ones', () => {
    const errors = validateAllocationClosureLines([
      makeLine({ allocationId: 'ok', producedQuantity: 100, rejectedQuantity: 0, plannedQuantity: 100 }),
      makeLine({ allocationId: 'bad', producedQuantity: 50, rejectedQuantity: 0, plannedQuantity: 100 }),
    ]);
    expect(errors.map((e) => e.allocationId)).toEqual(['bad']);
  });

  it('returns no errors for an empty list', () => {
    expect(validateAllocationClosureLines([])).toEqual([]);
  });
});
