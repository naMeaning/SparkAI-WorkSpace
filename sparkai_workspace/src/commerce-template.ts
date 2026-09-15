import templateSchema from "../plugins/commerce-template-schema.json" with { type: "json" };
import type { CommerceSetMode, CommerceSetPlan, CommercePlatformTemplateId } from "./plugins/commerce-set.ts";

export type CommerceTemplateSource = "built-in" | "personal";

export type CommerceTemplateEntry = {
  version: 1;
  id: string;
  source: CommerceTemplateSource;
  title: string;
  description?: string;
  revision: number;
  mode: CommerceSetMode;
  platformTemplateId: CommercePlatformTemplateId;
  slotCount: number;
  localeCount: number;
  createdAt?: string;
  updatedAt?: string;
  plan?: CommerceSetPlan;
};

export type CommerceTemplateResult = {
  ok: boolean;
  schemaVersion?: 1;
  libraryRevision?: number;
  items?: CommerceTemplateEntry[];
  entry?: CommerceTemplateEntry;
  changed?: boolean;
  imported?: boolean;
  canceled?: boolean;
  id?: string;
  deletedRevision?: number;
  sourceName?: string;
  path?: string;
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export const COMMERCE_TEMPLATE_SCHEMA_VERSION = templateSchema.schemaVersion;
export const COMMERCE_TEMPLATE_PORTABLE_TYPE = templateSchema.portableType;
export const COMMERCE_TEMPLATE_LIMITS = Object.freeze({ ...templateSchema.limits });
export const COMMERCE_TEMPLATE_BUILTIN_IDS = Object.freeze(templateSchema.builtIns.map((entry) => entry.id));
