import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import PayoutSettingsPanel from '../PayoutSettingsPanel';

const mockUpdateProfile = vi.fn();

vi.mock('@/hooks/api/useProfile', () => ({
  useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
}));

describe('PayoutSettingsPanel', () => {
  beforeEach(() => {
    mockUpdateProfile.mockReset();
  });

  it('renders initial payout settings values', () => {
    render(
      <PayoutSettingsPanel
        initialUser={{
          fullName: 'Alice',
          payoutWalletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ2345',
          preferredPayoutCurrency: 'USDC',
          payoutNotes: 'Pay weekly',
        }}
      />,
    );
    expect(screen.getByDisplayValue('GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ2345')).toBeInTheDocument();
    expect(screen.getByDisplayValue('USDC')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pay weekly')).toBeInTheDocument();
  });

  it('prevents save for invalid Stellar payout address', async () => {
    const user = userEvent.setup();
    render(<PayoutSettingsPanel initialUser={{ preferredPayoutCurrency: 'XLM' }} />);

    await user.type(screen.getByLabelText(/payout wallet address/i), 'not-a-stellar-address');
    await user.click(screen.getByRole('button', { name: /save payout settings/i }));

    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(await screen.findByText(/valid stellar wallet address/i)).toBeInTheDocument();
  });

  it('saves valid payout settings and shows success', async () => {
    const user = userEvent.setup();
    mockUpdateProfile.mockResolvedValue({});
    render(<PayoutSettingsPanel initialUser={{ preferredPayoutCurrency: 'XLM' }} />);

    const valid = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    await user.clear(screen.getByLabelText(/payout wallet address/i));
    await user.type(screen.getByLabelText(/payout wallet address/i), valid);
    await user.click(screen.getByRole('button', { name: /save payout settings/i }));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalled());
    expect(await screen.findByText('Payout settings updated.')).toBeInTheDocument();
  });

  it('shows save errors', async () => {
    const user = userEvent.setup();
    mockUpdateProfile.mockRejectedValue(new Error('Server unavailable'));
    render(<PayoutSettingsPanel initialUser={{ payoutWalletAddress: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' }} />);

    await user.click(screen.getByRole('button', { name: /save payout settings/i }));
    expect(await screen.findByText('Server unavailable')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<PayoutSettingsPanel initialUser={{}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
