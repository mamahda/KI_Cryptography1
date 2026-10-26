/**
 * Strict snake_case TypeScript interfaces for all Schematics NIC API endpoints.
 * Source of truth: Dokumentasi API & PRD Platform Pendaftaran Schematics NIC.
 */

import type { FinalizeMissingReason } from './errors'

/* -------------------------------------------------------------------------- */
/* Domain Enums / String Literal Unions                                       */
/* -------------------------------------------------------------------------- */

export const USER_ROLES = ['peserta', 'juri', 'superadmin'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const VERIFICATION_STATUSES = [
  'belum_lengkap',
  'menunggu',
  'terverifikasi',
  'ditolak',
] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export type AdminVerificationDecision = 'terverifikasi' | 'ditolak'

export const TEAM_STATUSES = ['draft', 'final'] as const
export type TeamStatus = (typeof TEAM_STATUSES)[number]

export const DOCUMENT_TYPES = ['ktp', 'ktm', 'twibbon'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const ITEM_FIELDS = ['ktp', 'ktm', 'twibbon', 'proposal', 'video'] as const
export type ItemField = (typeof ITEM_FIELDS)[number]

export const CIPHER_TYPES = ['aes', 'des', 'rc4'] as const
export type CipherType = (typeof CIPHER_TYPES)[number]

export const BENCHMARK_OPERATIONS = ['enc', 'dec', 'hmac'] as const
export type BenchmarkOperation = (typeof BENCHMARK_OPERATIONS)[number]

export const BENCHMARK_SOURCES = ['controlled', 'live'] as const
export type BenchmarkSource = (typeof BENCHMARK_SOURCES)[number]

export const AUDIT_ACTIONS = [
  'view_profile',
  'view_item',
  'verify_participant',
  'create_juri',
  'update_settings',
  'integrity_failure',
  'login_failed',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const FINALIZE_MISSING_ITEMS = [
  'proposal',
  'video',
  'repo_url',
  'min_members',
  'members_incomplete',
] as const
export type FinalizeMissingItem = FinalizeMissingReason

/* -------------------------------------------------------------------------- */
/* Shared Objects (Objek bersama)                                             */
/* -------------------------------------------------------------------------- */

export interface ItemMeta {
  item_id: string
  field: ItemField
  content_type: string
  size_bytes: number
  original_filename: string
  uploaded_at: string
}

export interface ConsentInfo {
  policy_version: string
  agreed_at: string
}

export interface MeTeamSummary {
  id: string
  name: string
  status: TeamStatus
  is_leader: boolean
}

/**
 * Shared `Me` object returned by register, login (wrapped in `{ user: Me }`), and `GET /api/me`.
 * For `juri` and `superadmin`, `verification_status`, `consent`, and `team` are `null`.
 */
export interface Me {
  id: string
  email: string
  role: UserRole
  full_name: string | null
  verification_status: VerificationStatus | null
  consent: ConsentInfo | null
  current_policy_version: string
  team: MeTeamSummary | null
}

export interface TeamMember {
  user_id: string
  full_name: string | null
  is_leader: boolean
  profile_complete: boolean
  documents_complete: boolean
}

export interface TeamSubmission {
  proposal: ItemMeta | null
  video: ItemMeta | null
  repo_url: string | null
}

export interface Team {
  id: string
  name: string
  code: string
  status: TeamStatus
  leader_id: string
  created_at: string
  finalized_at: string | null
  members: TeamMember[]
  submission: TeamSubmission
  finalize_missing: FinalizeMissingItem[]
}

export interface PaginationParams {
  page?: number
  page_size?: number
}

export interface PaginatedResponse<T> {
  items: T[]
  page: number
  page_size: number
  total: number
}

/* -------------------------------------------------------------------------- */
/* Auth & Account Endpoints                                                   */
/* - POST /api/auth/register                                                  */
/* - POST /api/auth/login                                                     */
/* - POST /api/auth/logout                                                    */
/* - GET  /api/me                                                             */
/* -------------------------------------------------------------------------- */

export interface RegisterRequest {
  email: string
  password: string
}

export interface AuthUserResponse {
  user: Me
}

export type RegisterResponse = AuthUserResponse

export interface LoginRequest {
  email: string
  password: string
}

export type LoginResponse = AuthUserResponse

export type LogoutResponse = void

export type GetMeResponse = Me

/* -------------------------------------------------------------------------- */
/* Public Settings, Privacy Policy & Consent Endpoints                        */
/* - GET  /api/settings                                                       */
/* - GET  /api/policy                                                         */
/* - POST /api/consent                                                        */
/* -------------------------------------------------------------------------- */

export interface FileSizeLimits {
  document_max_bytes: number
  proposal_max_bytes: number
  video_max_bytes: number
}

export interface PublicSettings {
  registration_deadline: string
  submission_deadline: string
  min_team_size: number
  max_team_size: number
  limits: FileSizeLimits
}

export interface PrivacyPolicyResponse {
  version: string
  text_markdown: string
}

export interface ConsentRequest {
  policy_version: string
}

export type ConsentResponse = ConsentInfo

/* -------------------------------------------------------------------------- */
/* Participant Profile & Documents Endpoints                                  */
/* - GET  /api/profile                                                        */
/* - PUT  /api/profile                                                        */
/* - GET  /api/documents                                                      */
/* - POST /api/documents/{type}                                               */
/* -------------------------------------------------------------------------- */

export interface ParticipantProfile {
  full_name: string | null
  nim: string | null
  study_program: string | null
  institution: string | null
  birth_date: string | null
  domicile: string | null
  phone: string | null
  age: number | null
  is_minor: boolean | null
  profile_complete: boolean
  verification_status: VerificationStatus
}

export interface UpdateProfileRequest {
  full_name: string
  nim: string
  study_program: string
  institution: string
  birth_date: string
  domicile: string
  phone: string
}

export type UpdateProfileResponse = ParticipantProfile

export interface ParticipantDocumentsResponse {
  ktp: ItemMeta | null
  ktm: ItemMeta | null
  twibbon: ItemMeta | null
  documents_complete: boolean
}

export interface UploadDocumentPathParams {
  type: DocumentType
}

export interface UploadDocumentResponse extends ItemMeta {
  verification_status: VerificationStatus
}

/* -------------------------------------------------------------------------- */
/* Teams & Hackathon Submission Endpoints                                     */
/* - POST   /api/teams                                                        */
/* - POST   /api/teams/join                                                   */
/* - GET    /api/teams/me                                                     */
/* - POST   /api/teams/me/leave                                               */
/* - DELETE /api/teams/me/members/{user_id}                                   */
/* - POST   /api/teams/me/proposal                                            */
/* - POST   /api/teams/me/video                                               */
/* - PUT    /api/teams/me/repo                                                */
/* - POST   /api/teams/me/finalize                                            */
/* -------------------------------------------------------------------------- */

export interface CreateTeamRequest {
  name: string
}

export interface TeamEnvelope {
  team: Team
}

export type CreateTeamResponse = TeamEnvelope

export interface JoinTeamRequest {
  code: string
}

export type JoinTeamResponse = TeamEnvelope

export interface MyTeamResponse {
  team: Team | null
}

export type LeaveTeamResponse = void

export interface RemoveTeamMemberPathParams {
  user_id: string
}

export type RemoveTeamMemberResponse = void

export type UploadProposalResponse = ItemMeta

export type UploadVideoResponse = ItemMeta

export interface UpdateRepoRequest {
  repo_url: string
}

export interface UpdateRepoResponse {
  repo_url: string
}

export interface FinalizeTeamRequest {
  confirm: true
}

export type FinalizeTeamResponse = TeamEnvelope

/* -------------------------------------------------------------------------- */
/* Raw Upload Progress & Binary Item Opening                                  */
/* - GET /api/items/{item_id}                                                 */
/* -------------------------------------------------------------------------- */

export interface UploadProgress {
  loaded: number
  total: number
  fraction: number | null
  percent: number | null
}

export interface GetItemPathParams {
  item_id: string
}

export interface GetItemQueryParams {
  download?: 1
}

export interface FetchedItemBlob {
  blob: Blob
  content_type: string
  size_bytes: number
  filename: string | null
  content_disposition: string | null
}

/* -------------------------------------------------------------------------- */
/* Juri Endpoints                                                             */
/* - GET /api/juri/teams                                                      */
/* - GET /api/juri/teams/{team_id}                                            */
/* -------------------------------------------------------------------------- */

export interface JuriTeamSummary {
  id: string
  name: string
  finalized_at: string
  member_count: number
}

export interface JuriTeamsResponse {
  teams: JuriTeamSummary[]
}

export interface JuriTeamPathParams {
  team_id: string
}

export interface JuriTeamMember {
  full_name: string | null
  institution: string | null
  is_leader: boolean
}

export interface JuriTeamDetail {
  id: string
  name: string
  finalized_at: string
  members: JuriTeamMember[]
  proposal: ItemMeta | null
  video: ItemMeta | null
  repo_url: string | null
}

export interface JuriTeamDetailResponse {
  team: JuriTeamDetail
}

/* -------------------------------------------------------------------------- */
/* Superadmin Endpoints                                                       */
/* - GET   /api/admin/participants                                            */
/* - GET   /api/admin/participants/{user_id}                                  */
/* - PATCH /api/admin/participants/{user_id}                                  */
/* - GET   /api/admin/teams                                                   */
/* - GET   /api/admin/juri                                                    */
/* - POST  /api/admin/juri                                                    */
/* - PUT   /api/admin/settings                                                */
/* - GET   /api/admin/audit-logs                                              */
/* - GET   /api/admin/benchmarks                                              */
/* -------------------------------------------------------------------------- */

export interface AdminParticipantsQueryParams extends PaginationParams {
  status?: VerificationStatus
}

export interface AdminParticipantListItem {
  user_id: string
  email: string
  full_name: string | null
  institution: string | null
  age: number | null
  is_minor: boolean | null
  verification_status: VerificationStatus
  documents_complete: boolean
  team_name: string | null
}

export type AdminParticipantsListResponse = PaginatedResponse<AdminParticipantListItem>

export interface AdminParticipantPathParams {
  user_id: string
}

export interface AdminParticipantTeamSummary {
  id: string
  name: string
  status: TeamStatus
}

export interface AdminParticipantDetailResponse {
  user_id: string
  email: string
  profile: ParticipantProfile
  documents: ParticipantDocumentsResponse
  verification_status: VerificationStatus
  verification_note: string | null
  team: AdminParticipantTeamSummary | null
}

export type VerifyParticipantRequest =
  | {
      verification_status: 'terverifikasi'
      note?: string | null
    }
  | {
      verification_status: 'ditolak'
      note: string
    }

export interface VerifyParticipantResponse {
  user_id: string
  verification_status: VerificationStatus
  verification_note: string | null
}

export type AdminTeamsQueryParams = PaginationParams

export interface AdminTeamListItem {
  id: string
  name: string
  status: TeamStatus
  member_count: number
  leader_name: string | null
  finalized_at: string | null
}

export type AdminTeamsListResponse = PaginatedResponse<AdminTeamListItem>

export interface AdminJuriAccount {
  user_id: string
  email: string
  created_at: string
}

export interface AdminJuriListResponse {
  juri: AdminJuriAccount[]
}

export interface CreateJuriRequest {
  email: string
  password: string
}

export interface CreateJuriResponse {
  user_id: string
  email: string
  role: 'juri'
}

export interface UpdateAdminSettingsRequest {
  registration_deadline: string
  submission_deadline: string
  min_team_size: number
  max_team_size: number
}

export type UpdateAdminSettingsResponse = PublicSettings

export interface AdminAuditLogsQueryParams extends PaginationParams {
  actor_id?: string
  action?: AuditAction
  from?: string
  to?: string
}

export interface AuditLogItem {
  id: number
  actor_id: string | null
  actor_email: string | null
  actor_role: UserRole | null
  action: AuditAction
  item_id: string | null
  subject_user_id: string | null
  created_at: string
}

export type AdminAuditLogsResponse = PaginatedResponse<AuditLogItem>

export interface AdminBenchmarksQueryParams {
  source?: BenchmarkSource
  operation?: BenchmarkOperation
}

export interface BenchmarkEnv {
  cpu: string
  aes_ni: boolean
  python: string
  pycryptodome: string
}

export interface BenchmarkRow {
  cipher: CipherType
  operation: BenchmarkOperation
  size_bytes: number
  n: number
  median_ns: number
  q1_ns: number
  q3_ns: number
  median_mb_s: number
}

export interface AdminBenchmarksResponse {
  env: BenchmarkEnv
  rows: BenchmarkRow[]
}

/* -------------------------------------------------------------------------- */
/* Complete Endpoint Contract Registry                                        */
/* -------------------------------------------------------------------------- */

export interface EndpointContract<
  TReq = void,
  TRes = void,
  TParams = void,
  TQuery = void,
> {
  params: TParams
  query: TQuery
  request: TReq
  response: TRes
}

export interface ApiEndpointContractMap {
  'POST /api/auth/register': EndpointContract<RegisterRequest, RegisterResponse>
  'POST /api/auth/login': EndpointContract<LoginRequest, LoginResponse>
  'POST /api/auth/logout': EndpointContract<void, LogoutResponse>
  'GET /api/me': EndpointContract<void, GetMeResponse>
  'GET /api/settings': EndpointContract<void, PublicSettings>
  'GET /api/policy': EndpointContract<void, PrivacyPolicyResponse>
  'POST /api/consent': EndpointContract<ConsentRequest, ConsentResponse>
  'GET /api/profile': EndpointContract<void, ParticipantProfile>
  'PUT /api/profile': EndpointContract<UpdateProfileRequest, UpdateProfileResponse>
  'GET /api/documents': EndpointContract<void, ParticipantDocumentsResponse>
  'POST /api/documents/{type}': EndpointContract<
    Blob | File,
    UploadDocumentResponse,
    UploadDocumentPathParams
  >
  'POST /api/teams': EndpointContract<CreateTeamRequest, CreateTeamResponse>
  'POST /api/teams/join': EndpointContract<JoinTeamRequest, JoinTeamResponse>
  'GET /api/teams/me': EndpointContract<void, MyTeamResponse>
  'POST /api/teams/me/leave': EndpointContract<void, LeaveTeamResponse>
  'DELETE /api/teams/me/members/{user_id}': EndpointContract<
    void,
    RemoveTeamMemberResponse,
    RemoveTeamMemberPathParams
  >
  'POST /api/teams/me/proposal': EndpointContract<Blob | File, UploadProposalResponse>
  'POST /api/teams/me/video': EndpointContract<Blob | File, UploadVideoResponse>
  'PUT /api/teams/me/repo': EndpointContract<UpdateRepoRequest, UpdateRepoResponse>
  'POST /api/teams/me/finalize': EndpointContract<FinalizeTeamRequest, FinalizeTeamResponse>
  'GET /api/items/{item_id}': EndpointContract<
    void,
    FetchedItemBlob,
    GetItemPathParams,
    GetItemQueryParams
  >
  'GET /api/juri/teams': EndpointContract<void, JuriTeamsResponse>
  'GET /api/juri/teams/{team_id}': EndpointContract<
    void,
    JuriTeamDetailResponse,
    JuriTeamPathParams
  >
  'GET /api/admin/participants': EndpointContract<
    void,
    AdminParticipantsListResponse,
    void,
    AdminParticipantsQueryParams
  >
  'GET /api/admin/participants/{user_id}': EndpointContract<
    void,
    AdminParticipantDetailResponse,
    AdminParticipantPathParams
  >
  'PATCH /api/admin/participants/{user_id}': EndpointContract<
    VerifyParticipantRequest,
    VerifyParticipantResponse,
    AdminParticipantPathParams
  >
  'GET /api/admin/teams': EndpointContract<
    void,
    AdminTeamsListResponse,
    void,
    AdminTeamsQueryParams
  >
  'GET /api/admin/juri': EndpointContract<void, AdminJuriListResponse>
  'POST /api/admin/juri': EndpointContract<CreateJuriRequest, CreateJuriResponse>
  'PUT /api/admin/settings': EndpointContract<
    UpdateAdminSettingsRequest,
    UpdateAdminSettingsResponse
  >
  'GET /api/admin/audit-logs': EndpointContract<
    void,
    AdminAuditLogsResponse,
    void,
    AdminAuditLogsQueryParams
  >
  'GET /api/admin/benchmarks': EndpointContract<
    void,
    AdminBenchmarksResponse,
    void,
    AdminBenchmarksQueryParams
  >
}
