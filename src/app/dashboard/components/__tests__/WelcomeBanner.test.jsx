import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import WelcomeBanner from '../WelcomeBanner';

describe('WelcomeBanner', () => {
  it('renders first name from user', () => {
    render(<WelcomeBanner user={{ fullName: 'Ada Lovelace' }} />);
    expect(screen.getByText('Welcome back, Ada!')).toBeInTheDocument();
  });

  it('falls back when user missing', () => {
    render(<WelcomeBanner />);
    expect(screen.getByText('Welcome back, Student!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start creator onboarding/i })).toHaveAttribute('href', '/onboarding');
  });

  it('has no axe violations', async () => {
    const { container } = render(<WelcomeBanner user={{ fullName: 'Ada Lovelace' }} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
