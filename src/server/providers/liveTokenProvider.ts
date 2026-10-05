import { GoogleGenAI, type AuthToken, type CreateAuthTokenParameters } from '@google/genai';

import {
  createLiveConnectConfig,
  LIVE_API_VERSION,
  LIVE_MODEL,
} from '../../shared/liveConfig.js';

export interface LiveSessionToken {
  token: string;
  liveModel: typeof LIVE_MODEL;
}

export interface LiveTokenProvider {
  mint(runtimeContext?: string): Promise<LiveSessionToken>;
}

export interface LiveTokenClient {
  create(request: CreateAuthTokenParameters): Promise<AuthToken>;
}

export interface GeminiLiveTokenProviderOptions {
  apiKey: string;
  client?: LiveTokenClient;
  now?: () => number;
}

export class GeminiLiveTokenProvider implements LiveTokenProvider {
  private readonly client: LiveTokenClient;
  private readonly now: () => number;

  constructor(options: GeminiLiveTokenProviderOptions) {
    this.client =
      options.client ??
      new GoogleGenAI({
        apiKey: options.apiKey,
        httpOptions: { apiVersion: LIVE_API_VERSION },
      }).authTokens;
    this.now = options.now ?? Date.now;
  }

  async mint(runtimeContext = ''): Promise<LiveSessionToken> {
    const now = this.now();
    const token = await this.client.create({
      config: {
        uses: 1,
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        expireTime: new Date(now + 15 * 60_000).toISOString(),
        liveConnectConstraints: {
          model: LIVE_MODEL,
          config: createLiveConnectConfig(runtimeContext),
        },
      },
    });

    if (!token.name) {
      throw new Error('Gemini returned an empty ephemeral Live token');
    }
    return { token: token.name, liveModel: LIVE_MODEL };
  }
}
