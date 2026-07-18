import type { MissionPlanDraft } from "./types";
import { CommandRuntimeError } from "./types";

/**
 * Provider-facing rules for the prose an operator sees in a mission plan.
 * Exact MCP routing, schema keys, and opaque identifiers remain available in
 * the structured action arguments; they are intentionally excluded here.
 */
export const OPERATOR_LANGUAGE_PROMPT_CONTRACT = [
  "Write every operator-visible field for a technically literate operator: precise, concise, and readable on the first pass; do not oversimplify established security terms.",
  "Operator-visible fields are strategySummary, rationaleSummary, phase, title, objective, explanation, rationale, successCriteria, reversibility, and action.intentSummary.",
  "Where relevant, state the immediate outcome, the method, why it matters, whether the target is contacted or changed, and what evidence will show success. Use direct subject-verb language.",
  "Terms such as CVE, NVD, provider, protocol, TLS, HTTP, and SMB are allowed when they add useful technical precision.",
  "Do not put MCP dispatch instructions, server/tool bindings, schema/property names, routing directives, placeholders, opaque references, or raw runtime field names in operator-visible fields. Keep those implementation details only in action.arguments.",
  "Avoid noun-heavy phrases such as 'sharpen prioritization toward'. Say directly what will be checked, why, and what will change as a result.",
  "Example: Check the highest-ranked CVE against its public NVD record to confirm the affected software versions and decide whether it is relevant. This reads public vulnerability data and does not contact the target.",
  "Example: Ask the vulnerability specialist to retrieve the public NVD record for the confirmed CVE ID so the team can assess applicability. This does not contact or change the target.",
] as const;

export interface OperatorLanguageViolation {
  readonly rule: string;
  readonly explanation: string;
}

const OPERATOR_LANGUAGE_RULES: readonly {
  readonly rule: string;
  readonly expression: RegExp;
  readonly explanation: string;
}[] = [
  {
    rule: "operator_language_internal_binding",
    expression: /\b(?:exact(?:ly)?\s+)?(?:reviewed|canonical|schema[- ]validated)\b[^.!?\n]{0,80}\b(?:tool\s+)?binding\b/iu,
    explanation: "Move reviewed binding and dispatch implementation details to the structured action arguments.",
  },
  {
    rule: "operator_language_internal_binding",
    expression: /\b(?:(?:exact\s+)?MCP\s+(?:server|tool|route|binding|projection)|(?:tool|runtime)\s+(?:binding|route|projection))\b/iu,
    explanation: "Move MCP routing and binding details to the structured action arguments.",
  },
  {
    rule: "operator_language_opaque_reference",
    expression: /\bopaque\s+(?:reference|identifier|id)\b/iu,
    explanation: "Describe the confirmed value or dependency in operator terms; keep its opaque identifier in action arguments.",
  },
  {
    rule: "operator_language_schema_jargon",
    expression: /\b(?:schema[- ](?:defined|internal|validated|compliant)|schema\s+(?:field|property|key)|canonical\s+propert(?:y|ies)(?:\s+names?)?|case-sensitive\s+propert(?:y|ies)(?:\s+names?)?)\b/iu,
    explanation: "Move schema and property-name instructions to technical action details.",
  },
  {
    rule: "operator_language_runtime_field",
    expression: /\b(?:action\.(?:kind|arguments)|assignedAgentId|mcpServer|toolName|TOOL_INPUT_CONTRACTS|REVIEWED_TOOL_BINDING_PROJECTIONS?)\b/u,
    explanation: "Move raw runtime field names to technical action details.",
  },
  {
    rule: "operator_language_raw_identifier",
    expression: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/u,
    explanation: "Replace a raw tool or schema identifier with a readable description and retain the identifier in action arguments.",
  },
  {
    rule: "operator_language_placeholder",
    expression: /\b(?:OPAQUE_[A-Z0-9_]+|TODO|TBD)\b|<[^>\n]+>|\$\{[^}\n]+\}|\{\{[^}\n]+\}\}/u,
    explanation: "Resolve placeholders before presenting a plan to the operator.",
  },
  {
    rule: "operator_language_indirect_priority",
    expression: /\bsharpen(?:s|ed|ing)?\s+(?:the\s+)?prioriti[sz]ation\b/iu,
    explanation: "State directly what will be checked and how the result will affect the next decision.",
  },
];

export function operatorLanguageViolation(value: string): OperatorLanguageViolation | null {
  const normalized = value.replace(/\s+/gu, " ").trim();
  for (const candidate of OPERATOR_LANGUAGE_RULES) {
    if (candidate.expression.test(normalized)) {
      return { rule: candidate.rule, explanation: candidate.explanation };
    }
  }
  return null;
}

function visiblePlanText(plan: MissionPlanDraft): readonly { path: string; value: string }[] {
  return [
    { path: "strategySummary", value: plan.strategySummary },
    { path: "rationaleSummary", value: plan.rationaleSummary },
    ...plan.steps.flatMap((step, index) => [
      { path: `steps[${index}].phase`, value: step.phase },
      { path: `steps[${index}].title`, value: step.title },
      { path: `steps[${index}].objective`, value: step.objective },
      { path: `steps[${index}].explanation`, value: step.explanation },
      { path: `steps[${index}].rationale`, value: step.rationale },
      ...step.successCriteria.map((value, criterionIndex) => ({
        path: `steps[${index}].successCriteria[${criterionIndex}]`,
        value,
      })),
      { path: `steps[${index}].reversibility`, value: step.reversibility },
      { path: `steps[${index}].action.intentSummary`, value: step.action.intentSummary },
    ]),
  ];
}

/**
 * Rejects provider prose that exposes runtime implementation language. The
 * normal bounded planner-repair loop can then request a complete clean plan;
 * no lossy local paraphrase is allowed to change the proposed action.
 */
export function assertOperatorReadablePlan(plan: MissionPlanDraft): void {
  for (const field of visiblePlanText(plan)) {
    const violation = operatorLanguageViolation(field.value);
    if (!violation) continue;
    throw new CommandRuntimeError(
      422,
      "invalid_plan",
      `${field.path} violates the operator-language contract`,
      {
        humanMessage: "The planning provider used internal runtime language in operator-visible plan text. The response was discarded before any action was created.",
        category: "invalid_input",
        details: {
          validationField: field.path,
          validationRule: violation.rule,
        },
        remediation: violation.explanation,
      },
    );
  }
}
