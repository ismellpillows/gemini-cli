/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OAuth2Client } from 'google-auth-library';
import type {
  CodeAssistGlobalUserSettingResponse,
  GoogleRpcResponse,
  LoadCodeAssistRequest,
  LoadCodeAssistResponse,
  LongRunningOperationResponse,
  OnboardUserRequest,
  SetCodeAssistGlobalUserSettingRequest,
} from './types.js';
import type {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import * as readline from 'node:readline';
import type { ContentGenerator } from '../core/contentGenerator.js';
import { UserTierId } from './types.js';
import type {
  CaCountTokenResponse,
  CaGenerateContentResponse,
} from './converter.js';
import {
  fromCountTokenResponse,
  fromGenerateContentResponse,
  toCountTokenRequest,
  toGenerateContentRequest,
} from './converter.js';
import { LogObjectType, SessionLogger } from '../core/session-logger.js';

/** HTTP options to be used in each of the requests. */
export interface HttpOptions {
  /** Additional HTTP headers to be sent with the request. */
  headers?: Record<string, string>;
}

export const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
export const CODE_ASSIST_API_VERSION = 'v1internal';

export class CodeAssistServer implements ContentGenerator {
  constructor(
    readonly client: OAuth2Client,
    readonly projectId?: string,
    readonly httpOptions: HttpOptions = {},
    readonly sessionId?: string,
    readonly userTier?: UserTierId,
    readonly sessionLogger?: SessionLogger,
  ) {}

  async generateContentStream(
    req: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const resps = await this.requestStreamingPost<CaGenerateContentResponse>(
      'streamGenerateContent',
      toGenerateContentRequest(
        req,
        userPromptId,
        this.projectId,
        this.sessionId,
      ),
      req.config?.abortSignal,
    );
    return (async function* (): AsyncGenerator<GenerateContentResponse> {
      for await (const resp of resps) {
        yield fromGenerateContentResponse(resp);
      }
    })();
  }

  async generateContent(
    req: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const resp = await this.requestPost<CaGenerateContentResponse>(
      'generateContent',
      toGenerateContentRequest(
        req,
        userPromptId,
        this.projectId,
        this.sessionId,
      ),
      req.config?.abortSignal,
    );
    return fromGenerateContentResponse(resp);
  }

  async onboardUser(
    req: OnboardUserRequest,
  ): Promise<LongRunningOperationResponse> {
    return await this.requestPost<LongRunningOperationResponse>(
      'onboardUser',
      req,
    );
  }

  async loadCodeAssist(
    req: LoadCodeAssistRequest,
  ): Promise<LoadCodeAssistResponse> {
    try {
      return await this.requestPost<LoadCodeAssistResponse>(
        'loadCodeAssist',
        req,
      );
    } catch (e) {
      if (isVpcScAffectedUser(e)) {
        return {
          currentTier: { id: UserTierId.STANDARD },
        };
      } else {
        throw e;
      }
    }
  }

  async getCodeAssistGlobalUserSetting(): Promise<CodeAssistGlobalUserSettingResponse> {
    return await this.requestGet<CodeAssistGlobalUserSettingResponse>(
      'getCodeAssistGlobalUserSetting',
    );
  }

  async setCodeAssistGlobalUserSetting(
    req: SetCodeAssistGlobalUserSettingRequest,
  ): Promise<CodeAssistGlobalUserSettingResponse> {
    return await this.requestPost<CodeAssistGlobalUserSettingResponse>(
      'setCodeAssistGlobalUserSetting',
      req,
    );
  }

  async countTokens(req: CountTokensParameters): Promise<CountTokensResponse> {
    const resp = await this.requestPost<CaCountTokenResponse>(
      'countTokens',
      toCountTokenRequest(req),
    );
    return fromCountTokenResponse(resp);
  }

  async embedContent(
    _req: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw Error();
  }

  async requestPost<T>(
    method: string,
    req: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = this.getMethodUrl(method);
    this.sessionLogger?.log(LogObjectType.MODEL_REQUEST, {
      url,
      method: 'POST',
      body: req,
    });
    const res = await this.client.request({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.httpOptions.headers,
      },
      responseType: 'json',
      body: JSON.stringify(req),
      signal,
    });
    this.sessionLogger?.log(LogObjectType.MODEL_RESPONSE, {
      url,
      method: 'POST',
      response: res.data,
    });
    return res.data as T;
  }

  async requestGet<T>(method: string, signal?: AbortSignal): Promise<T> {
    const url = this.getMethodUrl(method);
    this.sessionLogger?.log(LogObjectType.MODEL_REQUEST, {
      url,
      method: 'GET',
    });
    const res = await this.client.request({
      url,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...this.httpOptions.headers,
      },
      responseType: 'json',
      signal,
    });
    this.sessionLogger?.log(LogObjectType.MODEL_RESPONSE, {
      url,
      method: 'GET',
      response: res.data,
    });
    return res.data as T;
  }

  async requestStreamingPost<T>(
    method: string,
    req: object,
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<T>> {
    const url = this.getMethodUrl(method);
    this.sessionLogger?.log(LogObjectType.MODEL_REQUEST, {
      url,
      method: 'POST',
      params: {
        alt: 'sse',
      },
      body: req,
    });
    const res = await this.client.request({
      url,
      method: 'POST',
      params: {
        alt: 'sse',
      },
      headers: {
        'Content-Type': 'application/json',
        ...this.httpOptions.headers,
      },
      responseType: 'stream',
      body: JSON.stringify(req),
      signal,
    });

    const self = this;
    return (async function* (): AsyncGenerator<T> {
      const rl = readline.createInterface({
        input: res.data as NodeJS.ReadableStream,
        crlfDelay: Infinity, // Recognizes '\r\n' and '\n' as line breaks
      });

      let bufferedLines: string[] = [];
      for await (const line of rl) {
        // blank lines are used to separate JSON objects in the stream
        if (line === '') {
          if (bufferedLines.length === 0) {
            continue; // no data to yield
          }
          const chunk = JSON.parse(bufferedLines.join('\n')) as T;
          self.sessionLogger?.log(LogObjectType.MODEL_RESPONSE, {
            url,
            method: 'POST',
            response: chunk,
          });
          yield chunk;
          bufferedLines = []; // Reset the buffer after yielding
        } else if (line.startsWith('data: ')) {
          bufferedLines.push(line.slice(6).trim());
        } else {
          throw new Error(`Unexpected line format in response: ${line}`);
        }
      }
    })();
  }

  getMethodUrl(method: string): string {
    const endpoint =
      process.env['CODE_ASSIST_ENDPOINT'] ?? CODE_ASSIST_ENDPOINT;
    return `${endpoint}/${CODE_ASSIST_API_VERSION}:${method}`;
  }
}

function isVpcScAffectedUser(error: unknown): boolean {
  if (error && typeof error === 'object' && 'response' in error) {
    const gaxiosError = error as {
      response?: {
        data?: unknown;
      };
    };
    const response = gaxiosError.response?.data as
      | GoogleRpcResponse
      | undefined;
    if (Array.isArray(response?.error?.details)) {
      return response.error.details.some(
        (detail) => detail.reason === 'SECURITY_POLICY_VIOLATED',
      );
    }
  }
  return false;
}
