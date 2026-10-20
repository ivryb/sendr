import { sql } from "drizzle-orm"
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

import {
  CAMPAIGN_STATUSES,
  CONTACT_STATUSES,
  DELIVERY_STATUSES,
} from "../../shared/model"

export * from "./authSchema"

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" })
const createdAt = () =>
  timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date())

export const contacts = sqliteTable(
  "contacts",
  {
    id: id(),
    externalId: text("external_id").unique(),
    email: text("email").notNull().unique(),
    firstName: text("first_name"),
    fields: text("fields", { mode: "json" })
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'`),
    status: text("status", { enum: CONTACT_STATUSES })
      .notNull()
      .default("subscribed"),
    statusChangedAt: timestamp("status_changed_at"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => [index("contacts_status_idx").on(table.status)]
)

/** An address campaigns and login codes come from, with the email service that sends for it. */
export const senders = sqliteTable("senders", {
  id: id(),
  name: text("name").notNull().default(""),
  email: text("email").notNull(),
  replyTo: text("reply_to").notNull().default(""),
  provider: text("provider", { enum: ["ses"] }).notNull().default("ses"),
  region: text("region").notNull(),
  accessKeyId: text("access_key_id").notNull(),
  secretAccessKey: text("secret_access_key").notNull(),
  // The provider's view as of the last check, so lists don't call it on every load.
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  production: integer("production", { mode: "boolean" }).notNull().default(false),
  maxSendRate: real("max_send_rate").notNull().default(1),
  // Delivery reports arrive through this SNS topic once AWS confirms the subscription.
  eventsTopicArn: text("events_topic_arn"),
  eventsConnected: integer("events_connected", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
})

export const campaigns = sqliteTable("campaigns", {
  id: id(),
  subject: text("subject").notNull().default(""),
  markdown: text("markdown").notNull().default(""),
  status: text("status", { enum: CAMPAIGN_STATUSES })
    .notNull()
    .default("draft"),
  senderId: text("sender_id").references(() => senders.id, { onDelete: "set null" }),
  firstBatchSize: integer("first_batch_size").notNull().default(200),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
})

export const deliveries = sqliteTable(
  "deliveries",
  {
    id: id(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    // Null once the contact is deleted; the row stays for campaign counts.
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    batch: text("batch", { enum: ["first", "rest"] }).notNull(),
    status: text("status", { enum: DELIVERY_STATUSES })
      .notNull()
      .default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
  },
  (table) => [
    uniqueIndex("deliveries_campaign_contact_idx").on(
      table.campaignId,
      table.contactId
    ),
    index("deliveries_campaign_status_idx").on(table.campaignId, table.status),
    index("deliveries_provider_message_idx").on(table.providerMessageId),
  ]
)

export const apiKeys = sqliteTable("api_keys", {
  id: id(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  hash: text("hash").notNull().unique(),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at"),
})

/** One row (id 1) holding operator settings and secrets generated on first run. */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  footer: text("footer").notNull().default(""),
  publicUrl: text("public_url").notNull().default(""),
  // Signs Better Auth sessions and email link tokens.
  secret: text("secret").notNull(),
  // Part of the URL providers post delivery reports to, so only they can.
  webhookSecret: text("webhook_secret").notNull(),
})
