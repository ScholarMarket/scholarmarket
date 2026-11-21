import { apiClient } from '@/lib/api/apiClient';
import { cursorQuery } from '@/lib/pagination/query';

export const materialService = {
  getMarketplaceMaterials: async (params = {}) => {
    // Drop unset filters — URLSearchParams would otherwise send the literal
    // string "undefined", which the API treats as a real filter value.
    const searchParams = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
    return apiClient(`/api/market-materials?${searchParams.toString()}`);
  },

  getMaterialDetail: async (id) => {
    return apiClient(`/api/market-materials?id=${id}`);
  },

  getMaterialFeedback: async (id) => {
    return apiClient(`/api/materials/${id}/feedback`);
  },

  getUserMaterials: async (cursor, limit) => {
    return apiClient(`/api/materials${cursorQuery(cursor, limit)}`);
  },

  createMaterial: async (materialData) => {
    return apiClient('/api/materials', { body: materialData });
  },

  uploadFile: async (formData) => {
    return apiClient('/api/materials/upload', { 
      body: formData,
      headers: { 'Content-Type': undefined },
      method: 'POST'
    });
  },

  getDownloadUrl: async (id) => {
    return apiClient(`/api/materials/download/${id}`);
  },

  getSubjects: async () => {
    return apiClient('/api/subjects');
  },

  getNote: async (id) => {
    return apiClient(`/api/materials/${id}/notes`);
  },

  saveNote: async (id, note) => {
    return apiClient(`/api/materials/${id}/notes`, { method: 'PUT', body: { note } });
  },

  updateMaterial: async (id, updateData) => {
    return apiClient(`/api/materials?id=${id}`, {
      method: 'PUT',
      body: updateData,
    });
  },

  submitMaterialFeedback: async (id, feedbackData) => {
    return apiClient(`/api/materials/${id}/feedback`, {
      method: 'POST',
      body: feedbackData,
    });
  },

  getMaterialHistory: async (id) => {
    return apiClient(`/api/materials/history?id=${id}`);
  },

  reportMaterial: async (id, reportData) => {
    return apiClient(`/api/materials/${id}/report`, {
      method: 'POST',
      body: reportData,
    });
  },

  getTrendingMaterials: async (params = {}) => {
    const searchParams = new URLSearchParams({ ...params, sort: 'trending' });
    return apiClient(`/api/market-materials?${searchParams.toString()}`);
  },
};

