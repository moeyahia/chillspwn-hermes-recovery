// Types for the agent-orchestration board. The WS event contract the backend broadcasts is below.
import type { OrToolName } from "./toolIndicator";

export type CardStatus = "backlog" | "queued" | "running" | "done" | "failed";

// One entry in a card's live tool/skill timeline — maps 1:1 to a tasks.task_events row.
export interface ToolEvent {
  id: string;        // stable key (server: `${taskId}:<seq>`) for React keys + replay dedup
  ts: number;        // epoch ms
  kind: string;      // "tool" | "skill"
  name: string;      // tool/skill name → toolIndicator(name, detail)
  detail?: string;   // command / path / skill arg (one line)
  ok?: boolean;      // outcome once known
}

export type CreatedBy = "orchestrator" | "human";

export interface Card {
  id: string;
  title: string;
  task: string;             // the instruction body
  assignee: string | null;  // persona name = column id; null/__plan__ => backlog
  status: CardStatus;
  createdBy: CreatedBy;
  createdAt: number;
  provider?: string;   // the backend it actually ran on (inherited from the task creator)
  model?: string;
  pid?: number;
  tools: ToolEvent[];       // live timeline, appended incrementally
  result?: string;
  error?: string;
  engagement?: string;
}

export interface BoardColumn {
  persona: string;          // persona name = column id = assignee value
  position: number;
  wipLimit: number | null;
  enabled: boolean;
  isBacklog: boolean;
  color: string;
  icon: string;             // persona.icon token
  model?: string;
  provider?: string;
  allowedTools?: OrToolName[];
}

export const BACKLOG_COL = "__plan__";

// ── WS event contract (broadcast to all dashboard clients) ──
export type BoardEvent =
  | { type: "board_card_created"; card: Card }
  | { type: "board_card_updated"; taskId: string; patch: Partial<Card> }
  | { type: "board_tool"; taskId: string; event: ToolEvent }
  | { type: "board_columns"; columns: BoardColumn[] };
