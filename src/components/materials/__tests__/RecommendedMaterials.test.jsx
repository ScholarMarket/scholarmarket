import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import RecommendedMaterials from '../RecommendedMaterials';

const mockUseMarketplaceMaterials = vi.fn();

vi.mock('@/hooks/api/useMaterials', () => ({
  useMarketplaceMaterials: (...args) => mockUseMarketplaceMaterials(...args),
}));

vi.mock('next/image', () => ({
  default: (props) => <img {...props} alt={props.alt} />,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

describe('RecommendedMaterials', () => {
  beforeEach(() => {
    mockUseMarketplaceMaterials.mockReset();
  });

  it('excludes current material and renders recommendations', () => {
    mockUseMarketplaceMaterials
      .mockReturnValueOnce({
        isLoading: false,
        data: { items: [{ _id: 'cur', title: 'Current' }, { _id: 'm1', title: 'Rec 1', author: 'A', price: '1', level: 'year1' }] },
      })
      .mockReturnValueOnce({
        isLoading: false,
        data: { items: [{ _id: 'm2', title: 'Rec 2', author: 'B', price: '2', level: 'year2' }] },
      });

    render(<RecommendedMaterials currentId="cur" subject="Math" level="year2" />);
    expect(screen.queryByText('Current')).not.toBeInTheDocument();
    expect(screen.getByText('Rec 1')).toBeInTheDocument();
    expect(screen.getByText('Rec 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Rec 1/i })).toHaveAttribute('href', '/marketplace/m1');
  });

  it('shows loading skeleton', () => {
    mockUseMarketplaceMaterials.mockReturnValue({ isLoading: true, data: undefined });
    const { container } = render(<RecommendedMaterials currentId="x" />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders nothing when no recommendations', () => {
    mockUseMarketplaceMaterials.mockReturnValue({ isLoading: false, data: { items: [] } });
    const { container } = render(<RecommendedMaterials currentId="x" />);
    expect(container.firstChild).toBeNull();
  });
});
