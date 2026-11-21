export const queryKeys = {
  materials: {
    all: ['materials'],
    marketplace: (params) => ['materials', 'marketplace', params],
    trending: (params) => ['materials', 'trending', params],
    detail: (id) => ['materials', 'detail', id],
    feedback: (id) => ['materials', 'feedback', id],
    notes: (id) => ['materials', 'notes', id],
    user: (address) => ['materials', 'user', address],
    saved: (address) => ['materials', 'saved', address],
  },
  profile: {
    all: ['profile'],
    detail: (address) => ['profile', 'detail', address],
    activity: (address) => ['profile', 'activity', address],
    top: () => ['profile', 'top-creators'],
  },
  purchases: {
    all: ['purchases'],
    history: (address) => ['purchases', 'history', address],
    library: () => ['purchases', 'library'],
    entitlement: (materialId, address) => ['purchases', 'entitlement', materialId, address],
  },
  dashboard: {
    all: ['dashboard'],
    stats: (address) => ['dashboard', 'stats', address],
    metrics: (address, timeframe) => ['dashboard', 'metrics', address, timeframe],
    creatorAnalytics: () => ['dashboard', 'creator-analytics'],
    learningProgress: () => ['dashboard', 'learning-progress'],
  },
  taxonomy: {
    all: ['taxonomy'],
    subjects: () => ['taxonomy', 'subjects'],
  },
  admin: {
    all: ['admin'],
    moderation: () => ['admin', 'moderation'],
  },
  transactions: {
    all: ['transactions'],
    history: (params) => (params ? ['transactions', 'history', params] : ['transactions', 'history']),
  },
};
