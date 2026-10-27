/**
 * Surface, control and typography tokens for the console shell.
 *
 * The palette is a deep navy with a cyan accent, taken from the competition
 * portal reference in `referensi/`. Every text color here clears 4.5:1 against
 * its own surface; `slate-500` sits at 3.6:1 on `SURFACE_CARD` and is therefore
 * never used for text, only for decorative rules.
 */

/** Page background, applied once by the shell. */
export const SURFACE_PAGE = 'bg-[#080d18]'

/** Raised panel: the card every section lives in. */
export const SURFACE_CARD = 'bg-[#141d2e]'

/** Recessed well inside a card. */
export const SURFACE_WELL = 'bg-[#0e1626]'

export const BORDER = 'border-[#243049]'

export const CARD = `rounded-2xl border ${BORDER} ${SURFACE_CARD} shadow-[0_18px_50px_rgba(0,0,0,0.45)]`

export const WELL = `rounded-xl border ${BORDER} ${SURFACE_WELL}`

export const RECESSED = `rounded-lg border border-[#1e293f] ${SURFACE_WELL}`

export const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300'

/** The one bright control on a screen: dark text on the cyan accent. */
export const BTN_PRIMARY = `inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:from-cyan-300 hover:to-sky-400 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`

export const BTN_SECONDARY = `inline-flex cursor-pointer items-center gap-1.5 rounded-xl border ${BORDER} ${SURFACE_WELL} px-3.5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-cyan-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`

export const BTN_DANGER = `inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3.5 py-2.5 text-sm font-medium text-rose-200 transition hover:border-rose-400 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`

export const INPUT = `w-full rounded-xl border ${BORDER} bg-[#0b1220] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-400 transition focus:border-cyan-400/60 ${FOCUS}`

export const LABEL = 'block text-sm font-medium text-slate-300'

/** Section title above a card, in the reference's cyan-tinted heading style. */
export const SECTION_HEADING = 'text-lg font-bold tracking-tight text-cyan-50'

export const TH =
  'px-3 py-2.5 text-left text-xs font-semibold tracking-wide text-slate-400 uppercase'

export const TD = 'px-3 py-2.5 align-top text-sm text-slate-300'

/** Status pill base; callers append their own color classes. */
export const PILL =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap'
