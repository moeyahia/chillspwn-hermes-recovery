import type { Migration } from "../types";
import { coreMigration } from "./001_core";
import { memoryLearningMigration } from "./002_memory_learning";
import { searchMigration } from "./003_search";
import { evidenceIntegrityMigration } from "./004_evidence_integrity";
import { attackChainLearningMigration } from "./005_attack_chain_learning";
import { runEvaluationComparisonsMigration } from "./006_run_evaluation_comparisons";
import { auditJourneyMigration } from "./007_audit_journey";

export const DATABASE_MIGRATIONS: readonly Migration[] = Object.freeze([
  coreMigration,
  memoryLearningMigration,
  searchMigration,
  evidenceIntegrityMigration,
  attackChainLearningMigration,
  runEvaluationComparisonsMigration,
  auditJourneyMigration,
]);
