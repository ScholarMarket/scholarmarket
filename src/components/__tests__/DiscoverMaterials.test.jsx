import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DiscoverMaterials from '../DiscoverMaterials';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props) => <div {...props} /> }),
}));

vi.mock('next/image', () => ({
  default: (props) => <img {...props} alt={props.alt} />,
}));

describe('DiscoverMaterials', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders materials after loading and shows category controls', async () => {
    vi.useFakeTimers();
    render(<DiscoverMaterials />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(screen.getByText('Discover the Commons')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getAllByText(/XLM/).length).toBeGreaterThan(0);
  });

  it('updates active category styling when category selected', async () => {
    vi.useFakeTimers();
    render(<DiscoverMaterials />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    const science = screen.getByRole('button', { name: 'Science' });
    await act(async () => {
      fireEvent.click(science);
    });
    expect(screen.getByRole('button', { name: 'Science' }).className).toContain('bg-stellar-dark');
  });

  it('renders action buttons for loaded material cards', async () => {
    vi.useFakeTimers();
    render(<DiscoverMaterials />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    expect(screen.getByRole('button', { name: /load more materials/i })).toBeInTheDocument();
  });
});
