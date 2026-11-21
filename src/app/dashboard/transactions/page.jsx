"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  FaExternalLinkAlt,
  FaSearch,
  FaFilter,
  FaCopy,
  FaCheck,
  FaCheckCircle,
  FaClock,
  FaTimesCircle,
  FaShoppingBag,
  FaExchangeAlt,
  FaUndo,
  FaDollarSign,
  FaSyncAlt,
  FaChevronLeft,
  FaChevronRight,
} from "react-icons/fa";
import { getExplorerTxUrl } from "@/lib/config/chain";
import { useTransactionHistory } from "@/hooks/api/useTransactionHistory";
import EmptyState from "@/components/common/EmptyState";

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return String(dateStr);
  }
}

function truncateHash(hash, start = 6, end = 6) {
  if (!hash) return "—";
  if (hash.length <= start + end) return hash;
  return `${hash.slice(0, start)}…${hash.slice(-end)}`;
}

function resolveTransactionType(item) {
  const rawType = (item?.type || "").toLowerCase();
  const rawStatus = (item?.status || "").toLowerCase();
  if (rawType.includes("refund") || rawStatus === "refunded") return "Refund";
  if (rawType.includes("payout") || rawType.includes("withdrawal")) return "Payout";
  if (rawType.includes("purchase")) return "Purchase";
  if (rawType.includes("onchain")) return "On-Chain";
  return rawType
    ? rawType.charAt(0).toUpperCase() + rawType.slice(1).replace(/_/g, " ")
    : "Transaction";
}

function getTypeBadge(type) {
  switch (type) {
    case "Purchase":
      return {
        label: "Purchase",
        className:
          "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
        icon: <FaShoppingBag className="w-3 h-3 mr-1 shrink-0" />,
      };
    case "Refund":
      return {
        label: "Refund",
        className:
          "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
        icon: <FaUndo className="w-3 h-3 mr-1 shrink-0" />,
      };
    case "Payout":
      return {
        label: "Payout",
        className:
          "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
        icon: <FaDollarSign className="w-3 h-3 mr-1 shrink-0" />,
      };
    case "On-Chain":
    default:
      return {
        label: type,
        className:
          "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
        icon: <FaExchangeAlt className="w-3 h-3 mr-1 shrink-0" />,
      };
  }
}

function resolveTransactionStatus(item) {
  if (item?.status) {
    const s = String(item.status).toLowerCase();
    if (["completed", "confirmed", "settled", "success"].includes(s)) return "Completed";
    if (["pending", "indexing", "initiated", "processing"].includes(s)) return "Pending";
    if (["failed", "error", "cancelled"].includes(s)) return "Failed";
    if (["refunded", "refund"].includes(s)) return "Refunded";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  if (item?.successful !== undefined) {
    return item.successful ? "Completed" : "Failed";
  }
  return "Completed";
}

function getStatusBadge(status) {
  switch (status) {
    case "Completed":
      return {
        label: "Completed",
        className:
          "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800",
        icon: <FaCheckCircle className="w-3 h-3 mr-1 shrink-0" />,
      };
    case "Pending":
      return {
        label: "Pending",
        className:
          "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800",
        icon: <FaClock className="w-3 h-3 mr-1 shrink-0" />,
      };
    case "Failed":
      return {
        label: "Failed",
        className:
          "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800",
        icon: <FaTimesCircle className="w-3 h-3 mr-1 shrink-0" />,
      };
    case "Refunded":
      return {
        label: "Refunded",
        className:
          "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800",
        icon: <FaUndo className="w-3 h-3 mr-1 shrink-0" />,
      };
    default:
      return {
        label: status,
        className:
          "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
        icon: <FaClock className="w-3 h-3 mr-1 shrink-0" />,
      };
  }
}

function formatAmount(item) {
  if (item?.amount !== null && item?.amount !== undefined) {
    const num = Number(item.amount);
    return isNaN(num)
      ? String(item.amount)
      : num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  }
  if (item?.feeCharged !== null && item?.feeCharged !== undefined) {
    const feeInXlm = Number(item.feeCharged) / 10000000;
    return feeInXlm > 0 ? feeInXlm.toFixed(5) : "0.00";
  }
  return "—";
}

function resolveAsset(item) {
  if (item?.asset) return item.asset;
  if (item?.type === "onchain_transaction") return "XLM";
  return "USDC";
}

function resolveMaterial(item) {
  if (item?.material?.title) return item.material.title;
  if (item?.materialTitle) return item.materialTitle;
  if (item?.materialId) return `Material #${item.materialId}`;
  if (item?.memo) return `Memo: ${item.memo}`;
  return "—";
}

function TxHashLink({ hash }) {
  const [copied, setCopied] = useState(false);
  if (!hash) return <span className="text-gray-400 font-mono">—</span>;

  const explorerUrl = getExplorerTxUrl(hash);

  const handleCopy = (e) => {
    e.preventDefault();
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="explorer-link"
        className="inline-flex items-center gap-1.5 font-mono text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
        title={`View on Stellar Explorer: ${hash}`}
      >
        <span>{truncateHash(hash)}</span>
        <FaExternalLinkAlt className="w-2.5 h-2.5 shrink-0" />
      </a>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy transaction hash"}
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded transition-colors"
        title="Copy hash"
      >
        {copied ? (
          <FaCheck className="w-3 h-3 text-green-500" />
        ) : (
          <FaCopy className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-xs">
      <div className="divide-y divide-gray-200 dark:divide-gray-700 animate-pulse">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="p-4 flex items-center justify-between gap-4">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-28" />
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full w-20" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-36" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-12" />
            <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full w-24" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TransactionsPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useTransactionHistory();

  const [selectedType, setSelectedType] = useState("all");
  const [datePreset, setDatePreset] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const rawItems = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.items)) return data.items;
    return [];
  }, [data]);

  const filteredItems = useMemo(() => {
    let items = [...rawItems];

    // Filter by type
    if (selectedType !== "all") {
      items = items.filter((item) => {
        const type = resolveTransactionType(item).toLowerCase();
        return type === selectedType.toLowerCase();
      });
    }

    // Filter by date
    const now = new Date();
    if (datePreset === "7d") {
      const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      items = items.filter((item) => {
        const itemDate = new Date(item.createdAt || item.purchasedAt || 0);
        return itemDate >= past;
      });
    } else if (datePreset === "30d") {
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      items = items.filter((item) => {
        const itemDate = new Date(item.createdAt || item.purchasedAt || 0);
        return itemDate >= past;
      });
    } else if (datePreset === "90d") {
      const past = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      items = items.filter((item) => {
        const itemDate = new Date(item.createdAt || item.purchasedAt || 0);
        return itemDate >= past;
      });
    } else if (datePreset === "custom") {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        items = items.filter((item) => {
          const itemDate = new Date(item.createdAt || item.purchasedAt || 0);
          return itemDate >= start;
        });
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        items = items.filter((item) => {
          const itemDate = new Date(item.createdAt || item.purchasedAt || 0);
          return itemDate <= end;
        });
      }
    }

    // Filter by search keyword
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      items = items.filter((item) => {
        const hashMatch = String(item.hash || "").toLowerCase().includes(term);
        const materialMatch = resolveMaterial(item).toLowerCase().includes(term);
        const assetMatch = resolveAsset(item).toLowerCase().includes(term);
        const typeMatch = resolveTransactionType(item).toLowerCase().includes(term);
        return hashMatch || materialMatch || assetMatch || typeMatch;
      });
    }

    return items;
  }, [rawItems, selectedType, datePreset, startDate, endDate, searchTerm]);

  // Pagination calculation
  const totalItems = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, safePage, pageSize]);

  const handlePageChange = useCallback((newPage) => {
    setCurrentPage(newPage);
  }, []);

  const handleTypeChange = (type) => {
    setSelectedType(type);
    setCurrentPage(1);
  };

  const handleDatePresetChange = (preset) => {
    setDatePreset(preset);
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setSelectedType("all");
    setDatePreset("all");
    setStartDate("");
    setEndDate("");
    setSearchTerm("");
    setCurrentPage(1);
  };

  const isFiltered =
    selectedType !== "all" ||
    datePreset !== "all" ||
    startDate !== "" ||
    endDate !== "" ||
    searchTerm.trim() !== "";

  // Aggregate stats
  const stats = useMemo(() => {
    let purchasesCount = 0;
    let refundsCount = 0;
    let onchainCount = 0;
    let totalVolume = 0;

    rawItems.forEach((item) => {
      const type = resolveTransactionType(item);
      if (type === "Purchase") purchasesCount += 1;
      else if (type === "Refund") refundsCount += 1;
      else if (type === "On-Chain") onchainCount += 1;

      if (item.amount) {
        const num = Number(item.amount);
        if (!isNaN(num)) totalVolume += num;
      }
    });

    return {
      totalCount: rawItems.length,
      purchasesCount,
      refundsCount,
      onchainCount,
      totalVolume,
    };
  }, [rawItems]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Transactions</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Review your on-chain purchases, refunds, payouts, and ledger activity.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            title="Refresh transaction history"
          >
            <FaSyncAlt className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Total Transactions
          </div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {stats.totalCount}
          </div>
        </div>
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Purchases
          </div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
            {stats.purchasesCount}
          </div>
        </div>
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Refunds & Payouts
          </div>
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
            {stats.refundsCount}
          </div>
        </div>
        <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Total Volume
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {stats.totalVolume > 0
              ? stats.totalVolume.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })
              : "0.00"}
          </div>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-md">
            <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by hash, material, asset, or type..."
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-gray-800 transition"
            />
          </div>

          {/* Quick Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: "all", label: "All Time" },
              { id: "7d", label: "Last 7 Days" },
              { id: "30d", label: "Last 30 Days" },
              { id: "90d", label: "Last 90 Days" },
              { id: "custom", label: "Custom Range" },
            ].map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleDatePresetChange(preset.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  datePreset === preset.id
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-700/60 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Secondary Filter Row: Types & Custom Date Inputs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-gray-100 dark:border-gray-700/60">
          {/* Type Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1 mr-1">
              <FaFilter className="w-3 h-3" /> Type:
            </span>
            {[
              { id: "all", label: "All" },
              { id: "purchase", label: "Purchases" },
              { id: "on-chain", label: "On-Chain" },
              { id: "refund", label: "Refunds" },
              { id: "payout", label: "Payouts" },
            ].map((typeOption) => (
              <button
                key={typeOption.id}
                type="button"
                onClick={() => handleTypeChange(typeOption.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  selectedType === typeOption.id
                    ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                    : "border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {typeOption.label}
              </button>
            ))}
          </div>

          {/* Custom Date Range Pickers (shown when custom is selected) */}
          {datePreset === "custom" && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 dark:text-gray-400">From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 dark:text-gray-400">To:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* Reset Filters CTA */}
          {isFiltered && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium ml-auto"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Main Table / States Container */}
      {isLoading && <SkeletonTable />}

      {!isLoading && isError && (
        <EmptyState
          variant="error"
          title="Failed to load transaction history"
          description={
            error?.message ||
            "Unable to connect to the transaction history feed. Please check your connection and try again."
          }
          primaryAction={{
            label: "Try again",
            onClick: () => refetch(),
          }}
          secondaryAction={{
            label: "Go to Dashboard",
            href: "/dashboard",
          }}
        />
      )}

      {!isLoading && !isError && rawItems.length === 0 && (
        <EmptyState
          variant="no-data"
          title="No transactions yet"
          description="You don't have any recorded on-chain purchases, refunds, or payouts yet. Once you make a purchase or complete a transaction, it will be listed here."
          primaryAction={{
            label: "Browse Marketplace",
            href: "/marketplace",
            icon: <FaShoppingBag className="w-3.5 h-3.5" />,
          }}
        />
      )}

      {!isLoading && !isError && rawItems.length > 0 && filteredItems.length === 0 && (
        <EmptyState
          variant="no-results"
          title="No matching transactions"
          description="No transactions match the selected type, date range, or search criteria."
          primaryAction={{
            label: "Clear Filters",
            onClick: resetFilters,
          }}
        />
      )}

      {!isLoading && !isError && filteredItems.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-xs">
          {/* Table */}
          <div className="overflow-x-auto">
            <table
              data-testid="transactions-table"
              className="w-full text-left text-sm text-gray-600 dark:text-gray-300 divide-y divide-gray-200 dark:divide-gray-700"
            >
              <thead className="bg-gray-50/80 dark:bg-gray-900/60 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                <tr>
                  <th scope="col" className="px-6 py-3.5">
                    Date
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Type
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Material / Memo
                  </th>
                  <th scope="col" className="px-6 py-3.5 text-right">
                    Amount
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Asset
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3.5">
                    Transaction Hash
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700/60">
                {paginatedItems.map((item, index) => {
                  const type = resolveTransactionType(item);
                  const typeBadge = getTypeBadge(type);
                  const status = resolveTransactionStatus(item);
                  const statusBadge = getStatusBadge(status);
                  const dateStr = item.createdAt || item.purchasedAt || item.date;
                  const materialTitle = resolveMaterial(item);
                  const amount = formatAmount(item);
                  const asset = resolveAsset(item);
                  const key = item.id || item.hash || `tx-${index}`;

                  return (
                    <tr
                      key={key}
                      data-testid="transaction-row"
                      className="hover:bg-gray-50/70 dark:hover:bg-gray-700/40 transition-colors"
                    >
                      {/* Date */}
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-700 dark:text-gray-300">
                        {formatDate(dateStr)}
                      </td>

                      {/* Type */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${typeBadge.className}`}
                        >
                          {typeBadge.icon}
                          {typeBadge.label}
                        </span>
                      </td>

                      {/* Material / Details */}
                      <td className="px-6 py-4 max-w-xs truncate">
                        {item.materialId ? (
                          <Link
                            href={`/marketplace/${item.materialId}`}
                            className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 hover:underline truncate block"
                            title={materialTitle}
                          >
                            {materialTitle}
                          </Link>
                        ) : (
                          <span
                            className="text-gray-800 dark:text-gray-200 truncate block"
                            title={materialTitle}
                          >
                            {materialTitle}
                          </span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="px-6 py-4 whitespace-nowrap text-right font-medium text-gray-900 dark:text-white">
                        {amount}
                      </td>

                      {/* Asset */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-semibold text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                          {asset}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusBadge.className}`}
                        >
                          {statusBadge.icon}
                          {statusBadge.label}
                        </span>
                      </td>

                      {/* Transaction Hash with working Explorer Link */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <TxHashLink hash={item.hash} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Pagination Controls */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
              <span>
                Showing{" "}
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                  {totalItems > 0 ? (safePage - 1) * pageSize + 1 : 0}
                </span>{" "}
                to{" "}
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                  {Math.min(safePage * pageSize, totalItems)}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                  {totalItems}
                </span>{" "}
                transactions
              </span>

              <label className="flex items-center gap-1.5 ml-2">
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-700 dark:text-gray-300"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </label>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handlePageChange(safePage - 1)}
                  disabled={safePage <= 1}
                  aria-label="Previous Page"
                  className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <FaChevronLeft className="w-3 h-3" />
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(
                    (p) =>
                      p === 1 ||
                      p === totalPages ||
                      (p >= safePage - 1 && p <= safePage + 1)
                  )
                  .map((p, idx, arr) => {
                    const prev = arr[idx - 1];
                    return (
                      <span key={p} className="flex items-center">
                        {prev && p - prev > 1 && (
                          <span className="px-1.5 text-xs text-gray-400">…</span>
                        )}
                        <button
                          type="button"
                          onClick={() => handlePageChange(p)}
                          className={`w-8 h-8 rounded-lg text-xs font-medium transition ${
                            p === safePage
                              ? "bg-blue-600 text-white"
                              : "border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                          }`}
                        >
                          {p}
                        </button>
                      </span>
                    );
                  })}

                <button
                  type="button"
                  onClick={() => handlePageChange(safePage + 1)}
                  disabled={safePage >= totalPages}
                  aria-label="Next Page"
                  className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <FaChevronRight className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
