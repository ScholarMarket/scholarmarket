'use client';

/**
 * useTrustlineSetup
 *
 * Checks whether the connected wallet holds an active trustline for a given
 * asset and, if not, guides the buyer through a one-click `changeTrust`
 * transaction (build XDR → wallet sign → submit via Soroban RPC → poll for
 * confirmation).
 *
 * State machine
 * ─────────────
 *   idle        – not yet checked (address or asset absent)
 *   checking    – Horizon look-up in progress
 *   ok          – trustline confirmed present
 *   missing     – no trustline found; addTrustline() available
 *   adding      – changeTrust tx in flight (signing → submitting → confirming)
 *   confirmed   – changeTrust landed on-chain; consumer can resume checkout
 *   error       – any step failed; `errorMessage` contains a human-readable msg
 *
 * Usage
 * ─────
 *   const { trustlineStatus, addTrustline, errorMessage } = useTrustlineSetup({
 *     address,
 *     assetCode: 'USDC',
 *   });
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { checkBuyerTrustline, buildChangeTrustXdr } from '@/lib/stellar/horizonClient';
import { STELLAR_RPC_URL } from '@/lib/config/chain';

/** @typedef {'idle'|'checking'|'ok'|'missing'|'adding'|'confirmed'|'error'} TrustlineStatus */

const POLL_DELAY_MS = 2_000;
const POLL_MAX_ATTEMPTS = 20;

async function sendTx(signedXdr) {
  const res = await fetch(STELLAR_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: { transaction: signedXdr },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await res.json();
  if (payload.error) throw new Error(payload.error.message ?? 'sendTransaction failed');
  const { status, hash, errorResultXdr } = payload.result ?? {};
  if (status === 'ERROR') {
    throw new Error(`Transaction rejected: ${errorResultXdr ?? 'unknown error'}`);
  }
  return hash;
}

async function pollTx(hash) {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_DELAY_MS));
    const res = await fetch(STELLAR_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: { hash },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await res.json();
    if (payload.error) continue;
    const { status, resultXdr } = payload.result ?? {};
    if (status === 'SUCCESS') return hash;
    if (status === 'FAILED') {
      throw new Error(`changeTrust transaction failed on-chain: ${resultXdr ?? 'no detail'}`);
    }
  }
  throw new Error('changeTrust confirmation timed out — the trustline may still be pending.');
}

/**
 * @param {{ address: string|null, assetCode?: string, issuerAddress?: string }} opts
 * @returns {{
 *   trustlineStatus: TrustlineStatus,
 *   issuer: string|null,
 *   addTrustline: () => Promise<void>,
 *   recheck: () => void,
 *   errorMessage: string|null,
 * }}
 */
export function useTrustlineSetup({ address, assetCode = 'USDC', issuerAddress } = {}) {
  const { signTransaction } = useWallet();
  const [trustlineStatus, setTrustlineStatus] = useState(/** @type {TrustlineStatus} */ ('idle'));
  const [issuer, setIssuer] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  // Bump to trigger a re-check without remounting.
  const [recheckKey, setRecheckKey] = useState(0);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!address || !assetCode) {
      setTrustlineStatus('idle');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setTrustlineStatus('checking');
    setErrorMessage(null);

    checkBuyerTrustline(address, assetCode, issuerAddress)
      .then((result) => {
        if (controller.signal.aborted) return;
        setIssuer(result.issuer ?? null);
        setTrustlineStatus(result.hasTrustline ? 'ok' : 'missing');
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setErrorMessage(err?.message ?? 'Failed to check trustline.');
        setTrustlineStatus('error');
      });

    return () => controller.abort();
  }, [address, assetCode, issuerAddress, recheckKey]);

  const addTrustline = useCallback(async () => {
    if (!address || !assetCode) return;
    setTrustlineStatus('adding');
    setErrorMessage(null);

    try {
      // 1. Build the unsigned changeTrust XDR (includes dynamic fee).
      const { unsignedXdr } = await buildChangeTrustXdr(address, assetCode, issuerAddress);

      // 2. Ask the wallet to sign it.
      let signedXdr;
      try {
        signedXdr = await signTransaction(unsignedXdr);
      } catch (err) {
        const msg = err?.message ?? String(err);
        const cancelled = /clos|cancel|reject|dismiss/i.test(msg);
        throw Object.assign(
          new Error(cancelled ? 'Trustline setup cancelled in wallet.' : msg),
          { dismissed: cancelled },
        );
      }

      // 3. Submit to the Soroban RPC.
      const hash = await sendTx(signedXdr);

      // 4. Poll until the transaction lands.
      await pollTx(hash);

      setTrustlineStatus('confirmed');
    } catch (err) {
      setErrorMessage(err?.message ?? 'Failed to add trustline.');
      // If the user cancelled, let them try again from "missing" rather than
      // "error" so the gate stays friendly.
      setTrustlineStatus(err?.dismissed ? 'missing' : 'error');
    }
  }, [address, assetCode, issuerAddress, signTransaction]);

  const recheck = useCallback(() => {
    setRecheckKey((k) => k + 1);
  }, []);

  return { trustlineStatus, issuer, addTrustline, recheck, errorMessage };
}
