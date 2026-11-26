import { describe, expect, it } from 'vitest';
import { queryKeys } from '../queryKeys';

describe('queryKeys', () => {
  it('returns stable keys for identical inputs', () => {
    const params = { page: 1, q: 'math' };
    expect(queryKeys.materials.marketplace(params)).toEqual(
      queryKeys.materials.marketplace({ page: 1, q: 'math' }),
    );
    expect(queryKeys.dashboard.metrics('GABC', '7d')).toEqual(
      queryKeys.dashboard.metrics('GABC', '7d'),
    );
  });

  it('returns same key shape regardless of object identity', () => {
    const a = queryKeys.purchases.entitlement('mat-1', 'GABC');
    const b = queryKeys.purchases.entitlement('mat-1', 'GABC');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('produces different keys across different factories', () => {
    const keys = [
      queryKeys.materials.all,
      queryKeys.materials.marketplace({ q: 'x' }),
      queryKeys.materials.trending({ q: 'x' }),
      queryKeys.materials.detail('1'),
      queryKeys.materials.feedback('1'),
      queryKeys.materials.notes('1'),
      queryKeys.materials.user('G1'),
      queryKeys.materials.saved('G1'),
      queryKeys.profile.all,
      queryKeys.profile.detail('G1'),
      queryKeys.profile.activity('G1'),
      queryKeys.profile.top(),
      queryKeys.purchases.all,
      queryKeys.purchases.history('G1'),
      queryKeys.purchases.library(),
      queryKeys.purchases.entitlement('m1', 'G1'),
      queryKeys.dashboard.all,
      queryKeys.dashboard.stats('G1'),
      queryKeys.dashboard.metrics('G1', '30d'),
      queryKeys.dashboard.creatorAnalytics(),
      queryKeys.dashboard.learningProgress(),
      queryKeys.taxonomy.all,
      queryKeys.taxonomy.subjects(),
      queryKeys.admin.all,
      queryKeys.admin.moderation(),
      queryKeys.transactions.all,
      queryKeys.transactions.history({ page: 1 }),
    ];

    const serialized = keys.map((key) => JSON.stringify(key));
    expect(new Set(serialized).size).toBe(serialized.length);
  });
});
