export type RemoteAccessMode = 'off' | 'cloudflare-quick' | 'cloudflare-token' | 'tailscale';
export type RemoteAccessState = 'off' | 'starting' | 'needs-login' | 'connected' | 'error';
export interface RemoteAccessConfig {
  mode: RemoteAccessMode;
  publicHostname: string;
  funnel: boolean;
  cloudflareToken: '********' | null;
  tailscaleAuthKey: '********' | null;
}
/** Omitted secrets are retained; null clears them. Never submit the mask. */
export interface RemoteAccessConfigure {
  mode: RemoteAccessMode;
  publicHostname?: string;
  funnel?: boolean;
  cloudflareToken?: string | null;
  tailscaleAuthKey?: string | null;
}
export interface RemoteAccessStatus {
  mode: RemoteAccessMode;
  state: RemoteAccessState;
  url: string | null;
  urls: string[];
  loginUrl: string | null;
  funnel: boolean;
  lastError: string | null;
  externallyManaged: boolean;
  available: boolean;
  desiredEnabled: boolean;
  gatewayServiceUrl: string;
  warning: string | null;
  config: RemoteAccessConfig;
}
