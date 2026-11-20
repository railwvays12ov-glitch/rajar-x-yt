import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, bigint } from 'drizzle-orm/pg-core';
import type { ProcessOptions, ApiScope, WebhookEvent } from '../../shared/types.js';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['user', 'admin', 'owner'] })
    .notNull()
    .default('user'),
  disabled: boolean('disabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** HMAC-SHA-256(pepper, rawKey). The raw key is never stored. */
    keyHash: text('key_hash').notNull().unique(),
    displayPrefix: text('display_prefix').notNull(),
    scopes: jsonb('scopes').$type<ApiScope[]>().notNull(),
    /** NULL = unlimited (admin-set). */
    rateLimitPerMinute: integer('rate_limit_per_minute').default(60),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    anonId: text('anon_id'),
    apiKeyId: text('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    sourceUrl: text('source_url').notNull(),
    platform: text('platform').notNull(),
    title: text('title'),
    durationSeconds: real('duration_seconds'),
    mediaType: text('media_type').notNull(),
    format: text('format').notNull(),
    quality: text('quality').notNull(),
    options: jsonb('options').$type<ProcessOptions>().notNull(),
    status: text('status').notNull(),
    progress: real('progress').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    outputRef: text('output_ref'),
    outputFilename: text('output_filename'),
    outputSizeBytes: bigint('output_size_bytes', { mode: 'number' }),
    logs: jsonb('logs').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  },
  (t) => [
    index('jobs_user_created_idx').on(t.userId, t.createdAt),
    index('jobs_anon_created_idx').on(t.anonId, t.createdAt),
    index('jobs_status_idx').on(t.status),
    index('jobs_expires_idx').on(t.expiresAt),
    index('jobs_request_idx').on(t.requestId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id').notNull(),
    userId: text('user_id'),
    apiKeyId: text('api_key_id'),
    action: text('action').notNull(),
    /** Salted hash of the client IP — raw IPs are not retained. */
    ipHash: text('ip_hash'),
    httpStatus: integer('http_status'),
    errorCode: text('error_code'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_request_idx').on(t.requestId), index('audit_action_created_idx').on(t.action, t.createdAt)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhooks = pgTable('webhooks', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  url: text('url'),
  events: jsonb('events').$type<WebhookEvent[]>().notNull().default([]),
  /** AES-256-GCM encrypted signing secret (needed server-side to sign deliveries). */
  secretEnc: text('secret_enc'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
