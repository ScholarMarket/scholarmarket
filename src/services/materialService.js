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
    if (process.env.NEXT_PUBLIC_DIRECT_UPLOADS === 'false') {
      return apiClient('/api/materials/upload', {
        body: formData,
        headers: { 'Content-Type': undefined },
        method: 'POST',
      });
    }

    const upload = async (file, kind) => {
      const signed = await apiClient('/api/materials/upload-url', {
        body: { name: file.name, mimeType: file.type, size: file.size, kind },
      });
      const payload = new FormData();
      payload.set('network', 'public');
      payload.set('file', file);
      const response = await fetch(signed.url, { method: 'POST', body: payload });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'Direct upload failed');
      const uploaded = result.data || result;
      if (!uploaded.cid) throw new Error('Direct upload did not return a CID');
      return { cid: uploaded.cid, token: signed.token };
    };

    const file = formData.get('file');
    const thumbnail = formData.get('thumbnail');
    const main = await upload(file, 'material');
    const image = thumbnail instanceof File ? await upload(thumbnail, 'thumbnail') : null;
    const fields = Object.fromEntries([...formData.entries()].filter(([key]) => key !== 'file' && key !== 'thumbnail'));
    return apiClient('/api/materials/upload-finalize', {
      body: {
        cid: main.cid,
        token: main.token,
        thumbnailCid: image?.cid,
        thumbnailToken: image?.token,
        fields,
      },
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

