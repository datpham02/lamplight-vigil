import { createLocalPlatform } from './LocalPlatform';
import { createRemotePlatform } from './RemotePlatform';
import type { Platform } from './Platform';
import type { PlatformTransport } from './PlatformTransport';

export interface PlatformResolution {
  readonly platform?: Platform | null;
  readonly transport?: PlatformTransport | null;
}

/** Returns the injected platform, or the local fallback when none is supplied. */
export function resolvePlatform(resolution: PlatformResolution | Platform | null | undefined): Platform {
  if (resolution === null || resolution === undefined) {
    return createLocalPlatform();
  }

  if (typeof resolution === 'object' && 'capabilities' in resolution) {
    return resolution as Platform;
  }

  const { platform, transport } = resolution as PlatformResolution;
  if (platform !== null && platform !== undefined) {
    return platform;
  }
  if (transport !== null && transport !== undefined) {
    return createRemotePlatform(transport);
  }
  return createLocalPlatform();
}
