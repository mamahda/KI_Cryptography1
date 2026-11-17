import { fetchApi, fetchBinary } from './http'
import type {
  ApproveSharingRequestBody,
  CreateSharingRequestBody,
  RegisterPublicKeyRequest,
  SharingAvailableItemsResponse,
  SharingItemsResponse,
  SharingKeyFile,
  SharingKeyResponse,
  SharingPublicKey,
  SharingRequest,
  SharingRequestsResponse,
} from './sharingTypes'

const BASE = '/api/sharing'

function requestPath(requestId: string): string {
  return `${BASE}/requests/${encodeURIComponent(requestId)}`
}

export const sharingApi = {
  getMyKey(signal?: AbortSignal): Promise<SharingKeyResponse> {
    return fetchApi<SharingKeyResponse>(`${BASE}/keys/me`, { signal })
  },

  registerKey(body: RegisterPublicKeyRequest): Promise<SharingPublicKey> {
    return fetchApi<SharingPublicKey>(`${BASE}/keys`, { method: 'POST', body })
  },

  createRequest(body: CreateSharingRequestBody): Promise<SharingRequest> {
    return fetchApi<SharingRequest>(`${BASE}/requests`, { method: 'POST', body })
  },

  listIncoming(signal?: AbortSignal): Promise<SharingRequestsResponse> {
    return fetchApi<SharingRequestsResponse>(`${BASE}/requests/incoming`, { signal })
  },

  listOutgoing(signal?: AbortSignal): Promise<SharingRequestsResponse> {
    return fetchApi<SharingRequestsResponse>(`${BASE}/requests/outgoing`, { signal })
  },

  listAvailableItems(
    requestId: string,
    signal?: AbortSignal,
  ): Promise<SharingAvailableItemsResponse> {
    return fetchApi<SharingAvailableItemsResponse>(
      `${requestPath(requestId)}/available-items`,
      { signal },
    )
  },

  approve(requestId: string, body: ApproveSharingRequestBody): Promise<SharingRequest> {
    return fetchApi<SharingRequest>(`${requestPath(requestId)}/approve`, {
      method: 'POST',
      body,
    })
  },

  reject(requestId: string): Promise<SharingRequest> {
    return fetchApi<SharingRequest>(`${requestPath(requestId)}/reject`, {
      method: 'POST',
      body: {},
    })
  },

  getKeyFile(requestId: string, signal?: AbortSignal): Promise<SharingKeyFile> {
    return fetchApi<SharingKeyFile>(`${requestPath(requestId)}/key-file`, { signal })
  },

  listItems(requestId: string, signal?: AbortSignal): Promise<SharingItemsResponse> {
    return fetchApi<SharingItemsResponse>(`${requestPath(requestId)}/items`, { signal })
  },

  /** Raw AES ciphertext; it is opened in the browser, never by the server. */
  getCiphertext(
    requestId: string,
    itemId: string,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    return fetchBinary(
      `${requestPath(requestId)}/items/${encodeURIComponent(itemId)}/ciphertext`,
      signal,
    )
  },
}
