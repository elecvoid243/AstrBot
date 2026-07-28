import type { AxiosRequestConfig } from 'axios';

export interface SearchMatch {
  message_index: number;
  role: string;
  snippet: string;
  match_offset: number;
}

export interface SearchConversation {
  session_id: string;
  title: string;
  updated_at: number;
  matches: SearchMatch[];
}

export interface MessageSearchResponse {
  results: SearchConversation[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
}

export const messageApi = {
  async searchMessages(
    q: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<MessageSearchResponse> {
    const url = new URL('/api/v1/messages/search', window.location.origin);
    url.searchParams.set('q', q);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));

    const token = localStorage.getItem('token') || '';
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      },
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.status === 'ok' && data.data) {
      return data.data as MessageSearchResponse;
    }
    throw new Error('Invalid response format');
  },
};
