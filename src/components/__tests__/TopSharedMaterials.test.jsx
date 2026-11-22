import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TopSharedMaterials from '../TopSharedMaterials';

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props) => <div {...props} /> }),
}));

vi.mock('next/image', () => ({
  default: (props) => <img {...props} alt={props.alt} />,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

describe('TopSharedMaterials', () => {
  it('renders featured material and shared list', () => {
    render(<TopSharedMaterials />);
    expect(screen.getByText('Top Shared Materials')).toBeInTheDocument();
    expect(screen.getByText('ECN 101 - Principles of Microeconomics')).toBeInTheDocument();
    expect(screen.getByText('CHM 112 - Lab Report (Year 1)')).toBeInTheDocument();
  });

  it('renders top earners in descending rank order', () => {
    render(<TopSharedMaterials />);
    const ranks = screen.getAllByText(/^[1-5]$/).map((el) => el.textContent);
    expect(ranks).toEqual(['1', '2', '3', '4', '5']);
  });

  it('links to marketplace', () => {
    render(<TopSharedMaterials />);
    expect(screen.getByRole('link', { name: /browse all materials/i })).toHaveAttribute('href', '/marketplace');
  });
});
