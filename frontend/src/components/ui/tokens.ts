/**
 * Shared surface, control and typography tokens for the dark console shell.
 *
 * The participant pages each declared these inline before there were nine
 * screens sharing them; new pages import from here instead of re-deriving the
 * hex values.
 */

export const CARD =
  'rounded-xl border border-[#222] bg-[#121212] shadow-[0_10px_40px_rgba(0,0,0,0.8)]'

export const WELL = 'rounded-lg border border-[#222] bg-black'

export const RECESSED = 'rounded-md border border-[#2a2a2a] bg-[#0a0a0a]'

export const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-100'

export const BTN_PRIMARY = `inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-[#ededed] px-4 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`

export const BTN_SECONDARY = `inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#333] bg-black px-3.5 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`

export const BTN_DANGER = `inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-red-500/40 bg-red-950/30 px-3.5 py-2 text-sm font-medium text-red-200 transition hover:border-red-400 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`

export const INPUT = `w-full rounded-md border border-[#333] bg-black px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 transition focus:border-zinc-500 ${FOCUS}`

export const LABEL = 'block text-sm font-medium text-zinc-300'

export const SECTION_HEADING = 'px-1 text-sm font-semibold tracking-wide text-zinc-200 uppercase'

/** Table chrome: `<th>` and `<td>` share the same horizontal rhythm. */
export const TH = 'px-3 py-2.5 text-left text-xs font-semibold tracking-wide text-zinc-400 uppercase'

export const TD = 'px-3 py-2.5 text-sm text-zinc-300 align-top'
