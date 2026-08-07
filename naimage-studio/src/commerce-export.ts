import commerceCatalogSchema from "../plugins/commerce-catalog-schema.json" with { type: "json" };
import type { CommercePlatformId } from "./commerce-catalog.ts";

export type CommerceExportFormat = "jpeg" | "png";

export type CommerceExportIssue = {
  issueId: string;
  code: string;
  severity: "warning" | "blocking";
  message: string;
  productId?: string;
  skuId?: string;
  linkId?: string;
};

export type CommerceExportImage = {
  linkId: string;
  role: string;
  state: "candidate" | "approved";
  sourceFileName: string;
  outputPath: string;
  fileName: string;
  format: CommerceExportFormat;
  contentHash: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  valid: boolean;
  issueIds: string[];
};

export type CommerceExportPackage = {
  productId: string;
  productTitle: string;
  productCode: string;
  skuId: string;
  skuCode: string;
  skuTitle: string;
  directory: string;
  images: CommerceExportImage[];
  issueIds: string[];
};

export type CommerceExportSummary = {
  products: number;
  packages: number;
  exportablePackages: number;
  images: number;
  validImages: number;
  warnings: number;
  blockingIssues: number;
};

export type CommerceExportRequest = {
  expectedProjectId: string;
  expectedCatalogRevision: number;
  platform: CommercePlatformId;
  format: CommerceExportFormat;
  includeCandidates?: boolean;
  productIds?: string[];
  skuIds?: string[];
};

export type CommerceExportPreviewResult = {
  ok: boolean;
  projectId?: string;
  catalogRevision?: number;
  platform?: CommercePlatformId;
  platformLabel?: string;
  format?: CommerceExportFormat;
  includeCandidates?: boolean;
  selection?: { productIds: string[]; skuIds: string[] };
  summary?: CommerceExportSummary;
  packages?: CommerceExportPackage[];
  issues?: CommerceExportIssue[];
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

export type CommerceExportPackageResult = {
  ok: boolean;
  canceled?: boolean;
  projectId?: string;
  catalogRevision?: number;
  platform?: CommercePlatformId;
  format?: CommerceExportFormat;
  path?: string;
  folderName?: string;
  manifest?: string;
  summary?: CommerceExportSummary;
  errorCode?: string;
  error?: string;
  details?: Record<string, unknown>;
};

type ExportProfile = {
  id: CommercePlatformId;
  label: string;
  defaultFormat: CommerceExportFormat;
  allowedFormats: CommerceExportFormat[];
  minimumLongEdge: number;
  recommendedLongEdge: number;
  recommendedAspectRatio: number;
  aspectRatioTolerance: number;
  mainRoles: string[];
  requireWhiteMainBackground: boolean;
  whiteBackgroundThreshold: number;
  recommendedImagesPerSku: number;
};

export const COMMERCE_EXPORT_PROFILES = Object.freeze(
  (commerceCatalogSchema.exportProfiles as ExportProfile[]).map((profile) => ({
    ...profile,
    allowedFormats: [...profile.allowedFormats],
    mainRoles: [...profile.mainRoles]
  }))
);
