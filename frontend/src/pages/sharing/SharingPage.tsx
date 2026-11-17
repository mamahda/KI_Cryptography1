import { PAGE_TITLE } from '@/components/ui/tokens'
import { IncomingRequestsPanel } from './IncomingRequestsPanel'
import { KeySetupPanel } from './KeySetupPanel'
import { OutgoingRequestsPanel } from './OutgoingRequestsPanel'
import { RequestAccessPanel } from './RequestAccessPanel'

export function SharingPage() {
  return (
    <div data-testid="sharing-page" className="space-y-6">
      <header>
        <h1 className={PAGE_TITLE}>Berbagi Data</h1>
        <p className="mt-1.5 max-w-prose text-sm text-ink-3">
          Bagikan data pribadi Anda kepada peserta lain, atau buka data yang dibagikan kepada Anda.
          Kunci data dienkripsi dengan RSA dan dikirim oleh pemilik di luar aplikasi; data dibuka
          di browser Anda.
        </p>
      </header>

      <KeySetupPanel />
      <RequestAccessPanel />
      <IncomingRequestsPanel />
      <OutgoingRequestsPanel />
    </div>
  )
}
