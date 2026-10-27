import { buildApiUrl } from '../config/env'
import {
  buildQueryString,
  fetchApi,
  fetchItemBlob,
  uploadFileWithProgress,
  type FetchItemBlobOptions,
  type QueryParamValue,
  type UploadFileOptions,
} from './http'
import type {
  AdminAuditLogsQueryParams,
  AdminAuditLogsResponse,
  AdminBenchmarksQueryParams,
  AdminBenchmarksResponse,
  AdminJuriListResponse,
  AdminParticipantDetailResponse,
  AdminParticipantsListResponse,
  AdminParticipantsQueryParams,
  AdminTeamsListResponse,
  AdminTeamsQueryParams,
  ConsentRequest,
  ConsentResponse,
  CreateJuriRequest,
  CreateJuriResponse,
  CreateTeamRequest,
  CreateTeamResponse,
  DocumentType,
  FetchedItemBlob,
  FinalizeTeamRequest,
  FinalizeTeamResponse,
  GetMeResponse,
  JoinTeamRequest,
  JoinTeamResponse,
  JuriTeamDetailResponse,
  JuriTeamsResponse,
  LeaveTeamResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  Me,
  MyTeamResponse,
  ParticipantDocumentsResponse,
  ParticipantProfile,
  PrivacyPolicyResponse,
  PublicSettings,
  RegisterRequest,
  RegisterResponse,
  RemoveTeamMemberResponse,
  UpdateAdminSettingsRequest,
  UpdateAdminSettingsResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
  UpdateRepoRequest,
  UpdateRepoResponse,
  UploadDocumentResponse,
  UploadProposalResponse,
  UploadVideoResponse,
  VerifyParticipantRequest,
  VerifyParticipantResponse,
} from './types'

export const apiClient = {
  auth: {
    register(body: RegisterRequest): Promise<RegisterResponse> {
      return fetchApi<RegisterResponse>('/api/auth/register', {
        method: 'POST',
        body,
      })
    },

    login(body: LoginRequest): Promise<LoginResponse> {
      return fetchApi<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body,
      })
    },

    logout(): Promise<LogoutResponse> {
      return fetchApi<LogoutResponse>('/api/auth/logout', {
        method: 'POST',
      })
    },

    async getMe(signal?: AbortSignal): Promise<GetMeResponse> {
      const result = await fetchApi<Me | { user: Me }>('/api/me', {
        method: 'GET',
        signal,
      })
      if (typeof result === 'object' && result !== null && 'user' in result) {
        return result.user
      }
      return result
    },
  },

  public: {
    getSettings(signal?: AbortSignal): Promise<PublicSettings> {
      return fetchApi<PublicSettings>('/api/settings', {
        method: 'GET',
        signal,
      })
    },

    getPolicy(signal?: AbortSignal): Promise<PrivacyPolicyResponse> {
      return fetchApi<PrivacyPolicyResponse>('/api/policy', {
        method: 'GET',
        signal,
      })
    },
  },

  consent: {
    accept(body: ConsentRequest): Promise<ConsentResponse> {
      return fetchApi<ConsentResponse>('/api/consent', {
        method: 'POST',
        body,
      })
    },
  },

  profile: {
    get(signal?: AbortSignal): Promise<ParticipantProfile> {
      return fetchApi<ParticipantProfile>('/api/profile', {
        method: 'GET',
        signal,
      })
    },

    update(body: UpdateProfileRequest): Promise<UpdateProfileResponse> {
      return fetchApi<UpdateProfileResponse>('/api/profile', {
        method: 'PUT',
        body,
      })
    },
  },

  documents: {
    list(signal?: AbortSignal): Promise<ParticipantDocumentsResponse> {
      return fetchApi<ParticipantDocumentsResponse>('/api/documents', {
        method: 'GET',
        signal,
      })
    },

    upload(
      type: DocumentType,
      file: Blob | File,
      options?: UploadFileOptions,
    ): Promise<UploadDocumentResponse> {
      return uploadFileWithProgress<UploadDocumentResponse>(
        `/api/documents/${encodeURIComponent(type)}`,
        file,
        options,
      )
    },
  },

  teams: {
    create(body: CreateTeamRequest): Promise<CreateTeamResponse> {
      return fetchApi<CreateTeamResponse>('/api/teams', {
        method: 'POST',
        body,
      })
    },

    join(body: JoinTeamRequest): Promise<JoinTeamResponse> {
      return fetchApi<JoinTeamResponse>('/api/teams/join', {
        method: 'POST',
        body,
      })
    },

    getMine(signal?: AbortSignal): Promise<MyTeamResponse> {
      return fetchApi<MyTeamResponse>('/api/teams/me', {
        method: 'GET',
        signal,
      })
    },

    leave(): Promise<LeaveTeamResponse> {
      return fetchApi<LeaveTeamResponse>('/api/teams/me/leave', {
        method: 'POST',
      })
    },

    removeMember(userId: string): Promise<RemoveTeamMemberResponse> {
      return fetchApi<RemoveTeamMemberResponse>(
        `/api/teams/me/members/${encodeURIComponent(userId)}`,
        {
          method: 'DELETE',
        },
      )
    },

    uploadProposal(
      file: Blob | File,
      options?: UploadFileOptions,
    ): Promise<UploadProposalResponse> {
      return uploadFileWithProgress<UploadProposalResponse>(
        '/api/teams/me/proposal',
        file,
        options,
      )
    },

    uploadVideo(file: Blob | File, options?: UploadFileOptions): Promise<UploadVideoResponse> {
      return uploadFileWithProgress<UploadVideoResponse>('/api/teams/me/video', file, options)
    },

    updateRepo(body: UpdateRepoRequest): Promise<UpdateRepoResponse> {
      return fetchApi<UpdateRepoResponse>('/api/teams/me/repo', {
        method: 'PUT',
        body,
      })
    },

    finalize(body: FinalizeTeamRequest = { confirm: true }): Promise<FinalizeTeamResponse> {
      return fetchApi<FinalizeTeamResponse>('/api/teams/me/finalize', {
        method: 'POST',
        body,
      })
    },
  },

  items: {
    getBlob(itemId: string, options?: FetchItemBlobOptions): Promise<FetchedItemBlob> {
      return fetchItemBlob(itemId, options)
    },

    getUrl(itemId: string, options?: { download?: boolean }): string {
      const query = options?.download ? buildQueryString({ download: 1 }) : ''
      return `${buildApiUrl(`/api/items/${encodeURIComponent(itemId)}`)}${query}`
    },
  },

  juri: {
    listTeams(signal?: AbortSignal): Promise<JuriTeamsResponse> {
      return fetchApi<JuriTeamsResponse>('/api/juri/teams', {
        method: 'GET',
        signal,
      })
    },

    getTeamDetail(teamId: string, signal?: AbortSignal): Promise<JuriTeamDetailResponse> {
      return fetchApi<JuriTeamDetailResponse>(
        `/api/juri/teams/${encodeURIComponent(teamId)}`,
        {
          method: 'GET',
          signal,
        },
      )
    },
  },

  admin: {
    listParticipants(
      params?: AdminParticipantsQueryParams,
      signal?: AbortSignal,
    ): Promise<AdminParticipantsListResponse> {
      return fetchApi<AdminParticipantsListResponse>('/api/admin/participants', {
        method: 'GET',
        query: params as Record<string, QueryParamValue> | undefined,
        signal,
      })
    },

    getParticipantDetail(
      userId: string,
      signal?: AbortSignal,
    ): Promise<AdminParticipantDetailResponse> {
      return fetchApi<AdminParticipantDetailResponse>(
        `/api/admin/participants/${encodeURIComponent(userId)}`,
        {
          method: 'GET',
          signal,
        },
      )
    },

    verifyParticipant(
      userId: string,
      body: VerifyParticipantRequest,
    ): Promise<VerifyParticipantResponse> {
      return fetchApi<VerifyParticipantResponse>(
        `/api/admin/participants/${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          body,
        },
      )
    },

    listTeams(
      params?: AdminTeamsQueryParams,
      signal?: AbortSignal,
    ): Promise<AdminTeamsListResponse> {
      return fetchApi<AdminTeamsListResponse>('/api/admin/teams', {
        method: 'GET',
        query: params as Record<string, QueryParamValue> | undefined,
        signal,
      })
    },

    listJuri(signal?: AbortSignal): Promise<AdminJuriListResponse> {
      return fetchApi<AdminJuriListResponse>('/api/admin/juri', {
        method: 'GET',
        signal,
      })
    },

    createJuri(body: CreateJuriRequest): Promise<CreateJuriResponse> {
      return fetchApi<CreateJuriResponse>('/api/admin/juri', {
        method: 'POST',
        body,
      })
    },

    updateSettings(body: UpdateAdminSettingsRequest): Promise<UpdateAdminSettingsResponse> {
      return fetchApi<UpdateAdminSettingsResponse>('/api/admin/settings', {
        method: 'PUT',
        body,
      })
    },

    listAuditLogs(
      params?: AdminAuditLogsQueryParams,
      signal?: AbortSignal,
    ): Promise<AdminAuditLogsResponse> {
      return fetchApi<AdminAuditLogsResponse>('/api/admin/audit-logs', {
        method: 'GET',
        query: params as Record<string, QueryParamValue> | undefined,
        signal,
      })
    },

    getBenchmarks(
      params?: AdminBenchmarksQueryParams,
      signal?: AbortSignal,
    ): Promise<AdminBenchmarksResponse> {
      return fetchApi<AdminBenchmarksResponse>('/api/admin/benchmarks', {
        method: 'GET',
        query: params as Record<string, QueryParamValue> | undefined,
        signal,
      })
    },
  },
}
