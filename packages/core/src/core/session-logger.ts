/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Storage } from '../config/storage.js';

export enum LogObjectType {
  MODEL_REQUEST = 'model_request',
  MODEL_RESPONSE = 'model_response',
  TOOL_CALL_SCHEDULE = 'tool_call_schedule',
  TOOL_CALL_RESULT = 'tool_call_result',
}

export interface SessionLogEntry {
  timestamp: string;
  type: LogObjectType;
  data: unknown;
}

export class SessionLogger {
  private logFilePath: string | undefined;
  private sessionId: string;
  private initialized = false;
  private storage: Storage;

  constructor(sessionId: string, storage: Storage) {
    this.sessionId = sessionId;
    this.storage = storage;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const logsDir = path.join(this.storage.getProjectTempDir(), 'logs');
    this.logFilePath = path.join(logsDir, `${this.sessionId}.log.jsonl`);

    try {
      await fs.mkdir(logsDir, { recursive: true });
      this.initialized = true;
    } catch (err) {
      console.error('Failed to initialize session logger:', err);
      this.initialized = false;
    }
  }

  async log(type: LogObjectType, data: unknown): Promise<void> {
    if (!this.initialized || !this.logFilePath) {
      // Fail silently if not initialized.
      return;
    }

    /**
     * Creates a replacer function for JSON.stringify to handle circular
     * references and BigInts.
     */
    const getCircularReplacer = () => {
      const seen = new WeakSet();
      return (key: string, value: unknown) => {
        // Handle BigInt separately as it's not supported by default
        if (typeof value === 'bigint') {
          return value.toString();
        }
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        return value;
      };
    };

    const newEntry: SessionLogEntry = {
      timestamp: new Date().toISOString(),
      type,
      data,
    };

    try {
      await fs.appendFile(
        this.logFilePath,
        JSON.stringify(newEntry, getCircularReplacer()) + '\n',
        'utf-8',
      );
    } catch (error) {
      console.debug('Error writing to session log file:', error);
    }
  }
}
