import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import StatsCards from '../StatsCards';

describe('StatsCards', () => {
  it('renders stats with formatted values', () => {
    render(<StatsCards />);
    expect(screen.getByText('Earnings')).toBeInTheDocument();
    expect(screen.getByText('2.00 XLM')).toBeInTheDocument();
    expect(screen.getByText('Uploaded Notes')).toBeInTheDocument();
    expect(screen.getByText('7 NOTES')).toBeInTheDocument();
    expect(screen.getByText('+12.3%')).toBeInTheDocument();
  });

  it('applies negative/positive change styling', () => {
    render(<StatsCards />);
    expect(screen.getByText('-5.3%').className).toContain('text-red-500');
    expect(screen.getByText('+12.3%').className).toContain('text-green-500');
  });

  it('has no axe violations', async () => {
    const { container } = render(<StatsCards />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
