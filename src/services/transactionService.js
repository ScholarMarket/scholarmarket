import { apiClient } from '@/lib/api/apiClient';
import { cursorQuery } from '@/lib/pagination/query';

export const transactionService = {
  /**
   * Fetches the authenticated user's transaction history from /api/transactions/history
   *
   * @param {object|string} [params={}] - Query parameters (cursor, limit, type, date range, etc.)
   * @returns {Promise<{items: Array, nextCursor?: string, hasMore?: boolean}>}
   */
  getTransactionHistory: async (params = {}) => {
    let queryString = '';
    if (typeof params === 'string') {
      queryString = cursorQuery(params);
    } else if (params && typeof params === 'object') {
      const searchParams = new URLSearchParams();
      if (params.cursor) searchParams.set('cursor', String(params.cursor));
      if (params.limit !== undefined && params.limit !== null) {
        searchParams.set('limit', String(params.limit));
      }
      if (params.type && params.type !== 'all') {
        searchParams.set('type', String(params.type));
      }
      if (params.startDate) {
        searchParams.set('startDate', String(params.startDate));
      }
      if (params.endDate) {
        searchParams.set('endDate', String(params.endDate));
      }
      const str = searchParams.toString();
      queryString = str ? `?${str}` : '';
    }
    return apiClient(`/api/transactions/history${queryString}`);
  },
};
