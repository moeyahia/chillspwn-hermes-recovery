export { LegacyMigrationService, restoreMigrationBackup } from "./LegacyMigrationService";
export { LegacyImporter } from "./LegacyImporter";
export { MigrationMetadataRepository } from "./MigrationMetadataRepository";
export { discoverLegacySources } from "./SourceDiscovery";
export { redactLegacyText, redactRecursively } from "./SecretSafety";
export type {
  LegacyMigrationOptions,
  LegacyMigrationResult,
  LegacySource,
  LegacySourceType,
  ReconciliationReport,
  SourceInventory,
  SourceMigrationResult,
} from "./types";
