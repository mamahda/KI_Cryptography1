import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient as defaultQueryClient } from './lib/queryClient'

interface AppProvidersProps {
  children: ReactNode
  client?: QueryClient
}

export function AppProviders({ children, client = defaultQueryClient }: AppProvidersProps) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
