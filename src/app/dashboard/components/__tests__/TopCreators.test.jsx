import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import TopCreators from '../TopCreators';

const mockUseTopCreators = vi.fn();

vi.mock('@/hooks/api/useProfile', () => ({
  useTopCreators: () => mockUseTopCreators(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

describe('TopCreators', () => {
  beforeEach(() => mockUseTopCreators.mockReset());

  it('renders loading skeleton state', () => {
    mockUseTopCreators.mockReturnValue({ isLoading: true, isError: false, data: null, error: null, refetch: vi.fn() });
    const { container } = render(<TopCreators />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders creators and formatted revenue/rank', () => {
    mockUseTopCreators.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: [
        { name: 'Alice Smith', revenue: '12 XLM', rank: 1 },
        { name: 'Bob Jones', revenue: '8 XLM', rank: 2 },
      ],
    });
    render(<TopCreators />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('12 XLM')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alice Smith/i })).toHaveAttribute('href', '/creator/alice-smith');
  });

  it('renders empty state', () => {
    mockUseTopCreators.mockReturnValue({ isLoading: false, isError: false, data: [], error: null, refetch: vi.fn() });
    render(<TopCreators />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    mockUseTopCreators.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: [{ name: 'Alice', revenue: '1 XLM', rank: 1 }],
    });
    const { container } = render(<TopCreators />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
