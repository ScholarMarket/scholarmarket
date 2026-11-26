import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import EarningsSection from '../EarningsSection';

const mockUseDashboardStats = vi.fn();

vi.mock('@/hooks/api/useProfile', () => ({
  useDashboardStats: () => mockUseDashboardStats(),
}));

describe('EarningsSection', () => {
  beforeEach(() => mockUseDashboardStats.mockReset());

  it('renders loading skeletons', () => {
    mockUseDashboardStats.mockReturnValue({ isLoading: true, isError: false, data: null, error: null, refetch: vi.fn() });
    const { container } = render(<EarningsSection />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders stats and formatted change styles', () => {
    mockUseDashboardStats.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: [
        { label: 'Revenue', value: '10 XLM', change: '+5%' },
        { label: 'Refunds', value: '1 XLM', change: '-2%' },
      ],
    });
    render(<EarningsSection />);
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('10 XLM')).toBeInTheDocument();
    expect(screen.getByText('+5% from last month').className).toContain('text-green-600');
    expect(screen.getByText('-2% from last month').className).toContain('text-red-600');
  });

  it('renders empty state when no data', () => {
    mockUseDashboardStats.mockReturnValue({ isLoading: false, isError: false, data: [], error: null, refetch: vi.fn() });
    render(<EarningsSection />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    mockUseDashboardStats.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: [{ label: 'Revenue', value: '10 XLM', change: '+5%' }],
    });
    const { container } = render(<EarningsSection />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
