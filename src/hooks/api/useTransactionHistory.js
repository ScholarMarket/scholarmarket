import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { transactionService } from '@/services/transactionService';
import { queryKeys } from '@/lib/query/queryKeys';
import { nextCursorParam } from '@/lib/pagination/query';

/**
 * Hook to fetch the authenticated user's transaction history.
 *
 * @param {object} [params={}] - Filter and pagination params (cursor, limit, type, date range, etc.)
 * @param {object} [options={}] - Additional react-query options.
 * @returns {object} TanStack React Query result containing { items, nextCursor, hasMore }.
 */
export function useTransactionHistory(params = {}, options = {}) {
  const hasParams = params && Object.keys(params).length > 0;
  const queryKey = hasParams
    ? queryKeys.transactions.history(params)
    : queryKeys.transactions.history();

  return useQuery({
    queryKey,
    queryFn: () => transactionService.getTransactionHistory(params),
    placeholderData: keepPreviousData,
    ...options,
  });
}

/**
 * Infinite query hook for cursor-paginated transaction history feed.
 *
 * @param {object} [params={}] - Query parameters.
 * @returns {object} TanStack React Query infinite query result.
 */
export function useInfiniteTransactionHistory(params = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.transactions.history(params),
    queryFn: ({ pageParam }) =>
      transactionService.getTransactionHistory({ ...params, cursor: pageParam }),
    initialPageParam: null,
    getNextPageParam: nextCursorParam,
  });
}
