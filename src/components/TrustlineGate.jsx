'use client';

/**
 * TrustlineGate
 *
 * Rendered by BuyNowModal whenever the buyer is missing a USDC trustline.
 * Explains what a trustline is, the minimum 0.5 XLM base-reserve increase,
 * and offers a one-click "Add trustline" button that drives the full
 * changeTrust flow via useTrustlineSetup.
 *
 * Props
 * ─────
 *   address           – buyer's Stellar G… address
 *   assetCode         – token being added (default 'USDC')
 *   issuerAddress     – optional issuer override
 *   onConfirmed       – called with no arguments once the trustline lands on-chain
 *   onCancel          – called when the buyer explicitly dismisses the gate
 */

import { useEffect } from 'react';
import { FaCheckCircle, FaExclamationCircle, FaInfoCircle, FaSpinner } from 'react-icons/fa';
import { useTrustlineSetup } from '@/hooks/useTrustlineSetup';

const RESERVE_XLM = '0.5';

function StatusIcon({ status }) {
  if (status === 'checking' || status === 'adding') {
    return <FaSpinner className="animate-spin text-blue-500" aria-hidden="true" />;
  }
  if (status === 'confirmed') {
    return <FaCheckCircle className="text-emerald-500" aria-hidden="true" />;
  }
  if (status === 'error') {
    return <FaExclamationCircle className="text-rose-500" aria-hidden="true" />;
  }
  return <FaInfoCircle className="text-amber-500" aria-hidden="true" />;
}

const STATUS_LABEL = {
  idle: 'Checking your wallet\u2026',
  checking: 'Checking your wallet\u2026',
  ok: 'Trustline active',
  missing: 'Trustline required',
  adding: 'Adding trustline\u2026',
  confirmed: 'Trustline added',
  error: 'Something went wrong',
};

const ADD_BUTTON_LABEL = {
  missing: 'Add USDC trustline',
  error: 'Try again',
};

export default function TrustlineGate({
  address,
  assetCode = 'USDC',
  issuerAddress,
  onConfirmed,
  onCancel,
}) {
  const { trustlineStatus, issuer, addTrustline, recheck, errorMessage } = useTrustlineSetup({
    address,
    assetCode,
    issuerAddress,
  });

  // Auto-advance as soon as the trustline is confirmed on-chain.
  useEffect(() => {
    if (trustlineStatus === 'confirmed') {
      onConfirmed?.();
    }
  }, [trustlineStatus, onConfirmed]);

  const isBusy = trustlineStatus === 'checking' || trustlineStatus === 'adding';
  const canAdd = trustlineStatus === 'missing' || trustlineStatus === 'error';

  return (
    <div
      role="region"
      aria-label="USDC trustline required"
      className="flex flex-col gap-5 rounded-2xl border border-amber-200 bg-amber-50 p-5"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-xl">
          <StatusIcon status={trustlineStatus} />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-900">
            {STATUS_LABEL[trustlineStatus] ?? 'Trustline required'}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {assetCode} · {issuer ?? 'resolving issuer\u2026'}
          </p>
        </div>
      </div>

      {/* Explanation — only shown when action is required */}
      {(trustlineStatus === 'missing' || trustlineStatus === 'error') && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-100 bg-white p-4 text-sm text-slate-700">
          <p>
            <span className="font-semibold">What is a trustline?</span> On the Stellar network
            every account must explicitly opt in to hold a non-XLM token such as{' '}
            <span className="font-semibold">{assetCode}</span>. This one-time setup is called
            establishing a trustline.
          </p>
          <p>
            <span className="font-semibold">Why does it cost XLM?</span> Stellar requires a
            minimum base-reserve of{' '}
            <span className="font-semibold">{RESERVE_XLM} XLM</span> per trustline to prevent
            spam. This XLM is not spent — it is locked in your account as a reserve and released
            if you ever remove the trustline.
          </p>
          <p>
            <span className="font-semibold">What happens next?</span> Click{' '}
            <em>Add {assetCode} trustline</em> below. Your wallet will ask you to sign a
            single <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">changeTrust</code>{' '}
            transaction. Once confirmed, your checkout will resume automatically — no need to
            start over.
          </p>
        </div>
      )}

      {/* Confirmed banner */}
      {trustlineStatus === 'confirmed' && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          <FaCheckCircle aria-hidden="true" />
          Trustline confirmed — resuming checkout…
        </div>
      )}

      {/* Error detail */}
      {trustlineStatus === 'error' && errorMessage && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700"
        >
          {errorMessage}
        </p>
      )}

      {/* Adding progress */}
      {trustlineStatus === 'adding' && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <FaSpinner className="animate-spin" aria-hidden="true" />
          <span>
            Waiting for wallet signature, then polling the Stellar network for
            confirmation…
          </span>
        </div>
      )}

      {/* Action row */}
      <div className="flex flex-col gap-2 sm:flex-row">
        {canAdd && (
          <button
            type="button"
            onClick={addTrustline}
            disabled={isBusy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
          >
            {isBusy ? (
              <FaSpinner className="animate-spin" aria-hidden="true" />
            ) : (
              <FaCheckCircle aria-hidden="true" />
            )}
            {ADD_BUTTON_LABEL[trustlineStatus] ?? `Add ${assetCode} trustline`}
          </button>
        )}

        {trustlineStatus === 'missing' && (
          <button
            type="button"
            onClick={recheck}
            disabled={isBusy}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2"
          >
            Re-check wallet
          </button>
        )}

        {onCancel && !isBusy && trustlineStatus !== 'confirmed' && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-2"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
