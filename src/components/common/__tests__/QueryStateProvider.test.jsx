import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryStateProvider } from '../QueryStateProvider';

describe('QueryStateProvider', () => {
  it('renders loading state', () => {
    render(
      <QueryStateProvider
        query={{ data: undefined, isLoading: true, isError: false, error: null, refetch: vi.fn() }}
        renderData={() => <div>data</div>}
      />,
    );
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renders error state and retries via refetch', async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    render(
      <QueryStateProvider
        query={{ data: undefined, isLoading: false, isError: true, error: new Error('Boom'), refetch }}
        renderData={() => <div>data</div>}
      />,
    );

    expect(screen.getByText('Failed to load data')).toBeInTheDocument();
    expect(screen.getByText('Boom')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when items are empty', () => {
    render(
      <QueryStateProvider
        query={{ data: { items: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() }}
        renderData={() => <div>data</div>}
      />,
    );
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('renders success state with normalized data', () => {
    render(
      <QueryStateProvider
        query={{
          data: { items: [{ id: 1, title: 'A' }] },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }}
        renderData={(items) => <div>{items[0].title}</div>}
      />,
    );
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('supports useInfiniteQuery page shape', () => {
    render(
      <QueryStateProvider
        query={{
          data: { pages: [{ items: [{ id: 1 }] }, { items: [{ id: 2 }] }] },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }}
        renderData={(items) => <div>count:{items.length}</div>}
      />,
    );
    expect(screen.getByText('count:2')).toBeInTheDocument();
  });
});
