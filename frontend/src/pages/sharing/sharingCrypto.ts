/**
 * The single place the sharing UI reaches for browser crypto. It targets the
 * contract in KONTRAK_SHARING_ASSIGNMENT_2.md section 6; until members 2 and 3
 * deliver `lib/sharingKeys.ts` and `lib/sharingData.ts` it uses the stand-in.
 *
 * To connect the real modules, replace this file's body with:
 *   export { generateKeyBackup, unlockPrivateKey, decryptWrappedKey } from '@/lib/sharingKeys'
 *   export { decryptSharedData } from '@/lib/sharingData'
 */
export {
  decryptSharedData,
  decryptWrappedKey,
  generateKeyBackup,
  unlockPrivateKey,
} from './devCrypto'
