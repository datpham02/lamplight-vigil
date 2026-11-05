import { createLocalPlatform } from './LocalPlatform';
import type { Platform } from './Platform';

/** Returns the injected platform, or the local fallback when none is supplied. */
export function resolvePlatform(platform: Platform | null | undefined): Platform {
  return platform ?? createLocalPlatform();
}
