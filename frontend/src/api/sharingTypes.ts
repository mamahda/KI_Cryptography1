/**
 * Sharing contract types (Assignment 2).
 * Source of truth: KONTRAK_SHARING_ASSIGNMENT_2.md, sections 4 and 5.
 */

export type SharingRequestStatus = 'pending' | 'approved' | 'rejected'

export interface SharingPublicKey {
  id: string
  public_key_spki_b64: string
}

export interface SharingKeyResponse {
  key: SharingPublicKey | null
}

export interface RegisterPublicKeyRequest {
  public_key_spki_b64: string
}

export interface SharingRequest {
  id: string
  owner_id: string
  requester_id: string
  status: SharingRequestStatus
  created_at: string
  decided_at: string | null
}

export interface CreateSharingRequestBody {
  owner_id: string
}

export interface SharingRequestsResponse {
  requests: SharingRequest[]
}

/** An item the owner may choose to share; never carries plaintext. */
export interface SharingAvailableItem {
  item_id: string
  field: string
  content_type: string | null
  size_bytes: number
  aes_available: boolean
}

export interface SharingAvailableItemsResponse {
  items: SharingAvailableItem[]
}

export interface ApproveSharingRequestBody {
  item_ids: string[]
}

/** Per-item metadata the recipient needs to verify and open a ciphertext. */
export interface SharingItemMetadata {
  item_id: string
  ciphertext_id: string
  field: string
  cipher: 'aes'
  key_version: number
  nonce_b64: string
  hmac_tag_b64: string
  content_type: string
  size_bytes: number
}

export interface SharingItemsResponse {
  items: SharingItemMetadata[]
}

export const SHARE_KEYS_FORMAT = 'schematics-share-keys-v1'

/** The file the owner sends to the recipient outside the application. */
export interface SharingKeyFile {
  format: typeof SHARE_KEYS_FORMAT
  request_id: string
  owner_id: string
  recipient_id: string
  recipient_key_id: string
  algorithm: 'RSA-OAEP-256'
  items: { item_id: string; ciphertext_id: string; encrypted_key_b64: string }[]
}

/** Only the owner's own approval may select this many items at once. */
export const MAX_SHARED_ITEMS = 20
