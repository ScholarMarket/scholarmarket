import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import TrendingMaterials from '../TrendingMaterials';

const mockUseTrendingMaterials = vi.fn();

vi.mock('@/hooks/api/useMaterials', () => ({
  useTrendingMaterials: (params) => mockUseTrendingMaterials(params),
}));

vi.mock('next/image', () => ({
  default: (props) => <img {...props} alt={props.alt} />,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

describe('TrendingMaterials', () => {
  beforeEach(() => mockUseTrendingMaterials.mockReset());

  it('renders loading state', () => {
    mockUseTrendingMaterials.mockReturnValue({ isLoading: true, isError: false, data: null, error: null, refetch: vi.fn() });
    const { container } = render(<TrendingMaterials />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders material data and correct links', () => {
    mockUseTrendingMaterials.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: { items: [{ _id: 'm1', title: 'Calc 101', author: 'Ada', likes: 12, price: '2', currency: 'XLM' }] },
    });
    render(<TrendingMaterials />);
    expect(screen.getByText('Calc 101')).toBeInTheDocument();
    expect(screen.getByText('by Ada')).toBeInTheDocument();
    expect(screen.getByText(/2 XLM/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Calc 101/i })).toHaveAttribute('href', '/marketplace/m1');
  });

  it('renders empty state when no items', () => {
    mockUseTrendingMaterials.mockReturnValue({ isLoading: false, isError: false, data: { items: [] }, error: null, refetch: vi.fn() });
    render(<TrendingMaterials />);
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    mockUseTrendingMaterials.mockReturnValue({
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      data: { items: [{ _id: 'm1', title: 'Calc 101', author: 'Ada', likes: 12, price: '2', currency: 'XLM' }] },
    });
    const { container } = render(<TrendingMaterials />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
