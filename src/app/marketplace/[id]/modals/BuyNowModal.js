"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { FaExclamationTriangle, FaTimes } from "react-icons/fa";
import { useWallet } from "@/hooks/useWallet";
import CheckoutReceiptModal from "../../../../../components/modals/CheckoutReceiptModal";
import ConnectWalletModal from "./ConnectWalletModal";
import TransactionStatusPanel from "@/components/transactions/TransactionStatusPanel";
import { useCreatePurchase, useStartAccessRequest } from "@/hooks/api/usePurchases";
import { ACCEPTED_ASSET, NATIVE_ASSET, getExplorerTxUrl } from "@/lib/config/chain";
import { TransactionStatus } from "@/lib/transactions/transaction";
import { useTransactionCenter } from "@/providers/TransactionProvider";
import { useStellarTransaction } from "@/hooks/useStellarTransaction";
import { fetchBalances, findAssetBalance } from "@/lib/wallet/balance";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Stellar accounts must hold a minimum base reserve.  The current network
 * value is 1 XLM for the base account entry plus 0.5 XLM per subentry
 * (trustline, offer, signer, …).  We use a conservative floor of 1.5 XLM
 * (base + one expected trustline for the payment asset) so the available
 * balance shown to the buyer reflects what they can actually spend.
 */
const XLM_MIN_RESERVE = 1.5;

// ── useWalletBalance hook ─────────────────────────────────────────────────────

/**
 * Fetches the buyer's balance for a given asset and returns whether they have
 * enough to cover `required` (price + fee).
 *
 * State shape:
 *   { status: 'idle'|'loading'|'loaded'|'unfunded'|'error',
 *     available: number,   // spendable balance for the asset
 *     hasSufficientFunds: boolean|null }
 *
 * Returns a `refresh()` function so the parent can trigger a re-fetch after a
 * successful purchase.
 */
function useWalletBalance({ address, assetCode, assetIssuer, required }) {
  const [status, setStatus] = useState("idle");
  const [available, setAvailable] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!address) {
      setStatus("idle");
      setAvailable(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");

    fetchBalances(address)
      .then((result) => {
        if (cancelled) return;
        if (result.status === "unfunded") {
          setStatus("unfunded");
          setAvailable(0);
          return;
        }
        const { balances, native } = result.snapshot;
        let spendable;
        if (assetCode === NATIVE_ASSET || !assetCode) {
          // XLM: subtract the minimum reserve so the buyer can't accidentally
          // drain the account below the network's required floor.
          spendable = Math.max(0, parseFloat(native.balance) - XLM_MIN_RESERVE);
        } else {
          // Non-native asset (e.g. USDC): report the token balance directly.
          // The XLM balance still needs to cover the fee, but the token is
          // what the buyer is spending, so we show and validate that.
          spendable = parseFloat(findAssetBalance(balances, assetCode, assetIssuer) ?? "0");
        }
        setAvailable(spendable);
        setStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        setAvailable(null);
      });

    return () => { cancelled = true; };
  }, [address, assetCode, assetIssuer, refreshTick]);

  const hasSufficientFunds = useMemo(() => {
    if (available === null || required === null || required === undefined) return null;
    return available >= required;
  }, [available, required]);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  return { status, available, hasSufficientFunds, refresh };
}
import TrustlineGate from "@/components/TrustlineGate";

const SUPPORTED_ASSETS = [
  { code: ACCEPTED_ASSET, issuer: null, label: `Stellar ${ACCEPTED_ASSET}` },
];

function useQuote(materialId, asset, price) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [quote, setQuote] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!materialId || !asset) return undefined;

    const loadingTimer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
    }, 0);

    const timeout = window.setTimeout(() => {
      const parsedPrice = Number.parseFloat(price || 0);

      if (Number.isNaN(parsedPrice)) {
        setError(new Error("Invalid material price"));
        setQuote(null);
      } else {
        setQuote({
          amount: parsedPrice.toFixed(2),
          asset: asset.code,
          fee: asset.code === "XLM" ? "0.10" : "0.05",
        });
      }

      setLoading(false);
    }, 350);

    return () => {
      window.clearTimeout(loadingTimer);
      window.clearTimeout(timeout);
    };
  }, [materialId, asset, price, refreshKey]);

  return {
    loading,
    error,
    quote,
    refresh: () => setRefreshKey((current) => current + 1),
  };
}

export default function BuyNowModal({
  isOpen,
  onClose,
  price,
  materialId,
  materialTitle,
  materialCreator,
  onAccessUpdated,
}) {
  const { address } = useWallet();
  const createPurchaseMutation = useCreatePurchase();
  const startAccessRequestMutation = useStartAccessRequest();
  const [showWallet, setShowWallet] = useState(false);
  const [email, setEmail] = useState("");
  const [selectedAsset, setSelectedAsset] = useState(SUPPORTED_ASSETS[0]);
  const [receiptStatus, setReceiptStatus] = useState("idle");
  const [receipt, setReceipt] = useState(null);
  const [checkoutError, setCheckoutError] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  // Trustline gate: set when build-xdr returns code:"missing_trustline"
  const [trustlineNeeded, setTrustlineNeeded] = useState(false);
  const [issuerForTrustline, setIssuerForTrustline] = useState(null);
  const { loading: quoteLoading, error: quoteError, quote, refresh } = useQuote(
    materialId,
    selectedAsset,
    price,
  );

  // ── Balance & funds check ─────────────────────────────────────────────────
  const required = useMemo(() => {
    if (!quote) return null;
    return parseFloat(quote.amount) + parseFloat(quote.fee || 0);
  }, [quote]);

  const {
    status: balanceStatus,
    available: availableBalance,
    hasSufficientFunds,
    refresh: refreshBalance,
  } = useWalletBalance({
    address,
    assetCode: selectedAsset?.code ?? ACCEPTED_ASSET,
    assetIssuer: selectedAsset?.issuer ?? null,
    required,
  });

  const balanceLoading = balanceStatus === "loading";
  const balanceUnknown = balanceStatus === "idle" || balanceStatus === "error";
  const {
    activeTransaction,
    beginTransaction,
    markStatus,
    confirmTransaction,
    failTransaction,
    clearTransaction,
    pushOptimisticToast,
  } = useTransactionCenter();

  const { execute: executeStellarTx } = useStellarTransaction();

  const isReceiptVisible = receiptStatus !== "idle";
  const explorerHint = useMemo(
    () => (receipt?.transactionHash ? getExplorerTxUrl(receipt.transactionHash) : activeTransaction.explorerUrl),
    [activeTransaction.explorerUrl, receipt?.transactionHash],
  );

  const resetCheckout = () => {
    setShowWallet(false);
    setReceiptStatus("idle");
    setReceipt(null);
    setCheckoutError(null);
    setDownloadError(null);
    setIsDownloading(false);
    setTrustlineNeeded(false);
    setIssuerForTrustline(null);
    createPurchaseMutation.reset();
    startAccessRequestMutation.reset();
    clearTransaction();
  };

  const handleClose = () => {
    resetCheckout();
    onClose();
  };

  const handleDownload = async () => {
    if (!materialId || !address) return;

    setIsDownloading(true);
    setDownloadError(null);

    try {
      const params = new URLSearchParams({ materialId, buyerAddress: address });
      const response = await fetch(`/api/download?${params.toString()}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || "Unable to request file decryption.");
      }

      if (payload.fileUrl) {
        window.open(payload.fileUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Unable to request file decryption.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePay = async () => {
    if (!address) {
      setShowWallet(true);
      beginTransaction({
        scope: "purchase",
        title: "Wallet required",
        message: "Connect your wallet to request access and complete payment.",
      });
      return;
    }

    const amount = quote?.amount || price;
    const asset = quote?.asset || selectedAsset.code;

    setCheckoutError(null);
    setDownloadError(null);
    setReceipt({
      itemName: materialTitle || `Material #${materialId}`,
      creator: materialCreator,
      transactionHash: null,
      totalAmount: amount,
      currency: asset,
      totalFee: quote?.fee || "0.00",
      purchasedAt: new Date().toISOString(),
    });
    setReceiptStatus("signing");

    try {
      beginTransaction({
        scope: "purchase",
        title: "Signing checkout",
        message: "Building the payment transaction\u2026",
      });

      const xdrResponse = await fetch("/api/checkout/build-xdr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyerAddress: address, amount, asset }),
      });

      if (!xdrResponse.ok) {
        const errBody = await xdrResponse.json().catch(() => ({}));
        // Missing trustline: show the guided gate instead of a generic error.
        if (errBody.code === "missing_trustline") {
          setIssuerForTrustline(errBody.issuer ?? null);
          setTrustlineNeeded(true);
          setReceiptStatus("idle");
          clearTransaction();
          return;
        }
        throw new Error(errBody.detail || errBody.error || "Failed to build payment transaction");
      }

      const { unsignedXdr, explorerBaseUrl } = await xdrResponse.json();

      markStatus(TransactionStatus.Signing, {
        title: "Signing checkout",
        message: "Approve the Stellar checkout in your wallet.",
      });

      const { hash: txHash } = await executeStellarTx(unsignedXdr, {
        description: "Checkout",
        explorerBaseUrl,
      });

      setReceiptStatus("confirming");
      setReceipt((current) => ({ ...current, transactionHash: txHash }));

      markStatus(TransactionStatus.PendingConfirmation, {
        txHash,
        title: "Confirming checkout",
        message: "The payment is being confirmed before access is granted.",
        explorerUrl: getExplorerTxUrl(txHash),
      });

      pushOptimisticToast({
        txHash,
        description: "Checkout",
        explorerBaseUrl,
      });

      await startAccessRequestMutation.mutateAsync({
        materialId,
        buyerAddress: address,
        email,
        amount,
        asset,
      });

      const result = await createPurchaseMutation.mutateAsync({
        materialId,
        buyerAddress: address,
        transactionHash: txHash,
        signedXdr: null,
        email,
        amount,
        asset,
      });

      const confirmedHash = result?.purchase?.transactionHash || result?.transactionHash || txHash;
      const confirmedAt = result?.purchase?.confirmedAt || result?.purchase?.createdAt || new Date().toISOString();

      setReceipt((current) => ({
        ...current,
        transactionHash: confirmedHash,
        purchasedAt: confirmedAt,
      }));
      setReceiptStatus("success");
      onAccessUpdated?.();
      refreshBalance();

      confirmTransaction({
        txHash: confirmedHash,
        title: "Access granted",
        message: "Payment is complete and this material is now unlocked.",
        explorerUrl: getExplorerTxUrl(confirmedHash),
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Purchase failed. Please try again.");
      setCheckoutError(error);
      setReceiptStatus("error");
      onAccessUpdated?.();
      failTransaction(error, {
        title: "Purchase incomplete",
        message: error.message || "Payment did not complete, so access was not granted.",
        retryable: true,
      });
    }
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && !isReceiptVisible ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[101] bg-black backdrop-blur-sm"
              onClick={handleClose}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 50 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 50 }}
              className="fixed inset-0 z-[102] flex items-center justify-center p-4"
            >
              <div className="relative w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
                <button
                  type="button"
                  onClick={handleClose}
                  className="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close checkout"
                >
                  <FaTimes />
                </button>

                <div className="mb-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                    Access request
                  </p>
                  <h2 className="mt-1 text-2xl font-bold text-slate-900">Complete payment to unlock</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    We will create a pending access request first. The material unlocks only after payment is confirmed.
                  </p>
                </div>

                {materialTitle ? (
                  <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">{materialTitle}</p>
                    {materialCreator ? (
                      <p className="mt-1 text-xs text-slate-500">by {materialCreator}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mb-4">
                  <label className="mb-2 block text-xs font-semibold text-slate-600">
                    EMAIL ADDRESS
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Enter your email"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                <div className="mb-4">
                  <label className="mb-2 block text-xs font-semibold text-slate-600">
                    PAYMENT ASSET
                  </label>
                  <select
                    value={selectedAsset.code}
                    onChange={(event) =>
                      setSelectedAsset(
                        SUPPORTED_ASSETS.find((assetOption) => assetOption.code === event.target.value) ||
                          SUPPORTED_ASSETS[0],
                      )
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
                  >
                    {SUPPORTED_ASSETS.map((assetOption) => (
                      <option key={assetOption.code} value={assetOption.code}>
                        {assetOption.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-slate-600">You will pay</span>
                  {quoteLoading ? (
                    <span className="text-slate-400">Loading quote...</span>
                  ) : quoteError ? (
                    <span className="text-rose-500">Error loading quote</span>
                  ) : quote ? (
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <Image src="/images/stellar.png" alt={selectedAsset.label} width={20} height={20} />
                      {quote.amount} {quote.asset}
                      {quote.fee ? <span className="text-xs text-slate-400">+{quote.fee} fee</span> : null}
                    </div>
                  ) : (
                    <span className="text-slate-400">No quote available</span>
                  )}
                  <button
                    type="button"
                    onClick={refresh}
                    className="text-left text-xs font-medium text-blue-600 underline sm:text-right"
                  >
                    Refresh
                  </button>
                </div>

                {/* Balance & insufficient-funds warning */}
                {address && quote ? (
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Your {selectedAsset.code} balance</span>
                      {balanceLoading ? (
                        <span className="text-slate-400">Checking…</span>
                      ) : balanceUnknown ? (
                        <span className="text-slate-400">—</span>
                      ) : balanceStatus === "unfunded" ? (
                        <span className="font-semibold text-rose-500">Account unfunded</span>
                      ) : (
                        <span className={`font-semibold ${hasSufficientFunds === false ? "text-rose-500" : "text-slate-700"}`}>
                          {availableBalance?.toFixed(4)} {selectedAsset.code}
                          {selectedAsset.code === NATIVE_ASSET ? (
                            <span className="ml-1 font-normal text-slate-400">(after {XLM_MIN_RESERVE} XLM reserve)</span>
                          ) : null}
                        </span>
                      )}
                    </div>

                    {hasSufficientFunds === false && !balanceLoading ? (
                      <div
                        role="alert"
                        className="mt-2 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700"
                      >
                        <FaExclamationTriangle className="mt-0.5 shrink-0 text-rose-500" aria-hidden="true" />
                        <div>
                          <p className="font-semibold">Insufficient funds</p>
                          <p className="mt-0.5">
                            You need{" "}
                            <span className="font-bold">
                              {required?.toFixed(4)} {selectedAsset.code}
                            </span>{" "}
                            (price + fee) but your available balance is{" "}
                            <span className="font-bold">
                              {availableBalance?.toFixed(4)} {selectedAsset.code}
                            </span>
                            . Top up your wallet and try again.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <TransactionStatusPanel
                  transaction={activeTransaction}
                  onRetry={handlePay}
                  onClear={clearTransaction}
                />

                <button
                  type="button"
                  onClick={handlePay}
                  disabled={
                    createPurchaseMutation.isPending ||
                    startAccessRequestMutation.isPending ||
                    quoteLoading ||
                    !quote ||
                    balanceLoading ||
                    hasSufficientFunds === false
                  }
                  className="mt-5 w-full rounded-2xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {createPurchaseMutation.isPending || startAccessRequestMutation.isPending
                    ? "Processing..."
                    : "Pay and unlock access"}
                </button>
                {/* Trustline gate — shown instead of the pay button when USDC
                    trustline is absent. Resumes checkout automatically on success. */}
                {trustlineNeeded ? (
                  <TrustlineGate
                    address={address}
                    assetCode={selectedAsset.code}
                    issuerAddress={issuerForTrustline}
                    onConfirmed={() => {
                      setTrustlineNeeded(false);
                      setIssuerForTrustline(null);
                      // Re-attempt checkout now that the trustline is confirmed.
                      handlePay();
                    }}
                    onCancel={() => {
                      setTrustlineNeeded(false);
                      setIssuerForTrustline(null);
                      clearTransaction();
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={handlePay}
                    disabled={
                      createPurchaseMutation.isPending ||
                      startAccessRequestMutation.isPending ||
                      quoteLoading ||
                      !quote
                    }
                    className="mt-5 w-full rounded-2xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    {createPurchaseMutation.isPending || startAccessRequestMutation.isPending
                      ? "Processing..."
                      : "Pay and unlock access"}
                  </button>
                )}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <CheckoutReceiptModal
        isOpen={isOpen && isReceiptVisible}
        status={receiptStatus === "idle" ? "success" : receiptStatus}
        itemName={receipt?.itemName || materialTitle}
        transactionHash={receipt?.transactionHash}
        explorerUrl={explorerHint}
        totalFee={receipt?.totalFee || quote?.fee}
        totalAmount={receipt?.totalAmount || quote?.amount || price}
        currency={receipt?.currency || quote?.asset || selectedAsset.code}
        purchasedAt={receipt?.purchasedAt}
        errorMessage={checkoutError?.message}
        onClose={handleClose}
        onRetry={handlePay}
        onDownload={handleDownload}
        isDownloading={isDownloading}
        downloadError={downloadError}
      />

      <ConnectWalletModal
        isOpen={showWallet}
        onClose={() => {
          setShowWallet(false);
          if (!address && activeTransaction.status === TransactionStatus.WaitingWallet) {
            failTransaction(new Error("Wallet connection required"), {
              title: "Wallet connection required",
              message: "Connect your wallet to complete this purchase.",
              retryable: true,
            });
          }
        }}
      />
    </>
  );
}
