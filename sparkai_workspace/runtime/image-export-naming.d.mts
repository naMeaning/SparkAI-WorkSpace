export function cleanExportFilenamePart(value: unknown, fallback: string): string;
export function exportFilenameTemplateError(template: string): string;
export function renderExportFilename(template: string, source: { title?: string; assetId?: string; key?: string; groupName?: string }, index: number): string;
