export function engagementReportViewUrl(engagementName: string): string {
  return `/api/reports/${encodeURIComponent(engagementName)}/view`;
}
