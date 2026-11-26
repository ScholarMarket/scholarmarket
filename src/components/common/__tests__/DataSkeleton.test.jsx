import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  ActivityItemSkeleton,
  CreatorItemSkeleton,
  MaterialCardSkeleton,
  StatCardSkeleton,
} from '../DataSkeleton';

describe('DataSkeleton', () => {
  it('renders material card skeleton structure', () => {
    const { container } = render(<MaterialCardSkeleton />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(3);
  });

  it('renders configured count of stat skeletons in a list', () => {
    const { container } = render(
      <div>
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>,
    );
    expect(container.querySelectorAll('.animate-pulse').length).toBe(12);
  });

  it('renders activity and creator skeletons', () => {
    const { container } = render(
      <>
        <ActivityItemSkeleton />
        <CreatorItemSkeleton />
      </>,
    );
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(4);
  });
});
