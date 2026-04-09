// ---------------------------------------------------------------------------
// Node — carries live simulation state
// ---------------------------------------------------------------------------
export interface CausalNode {
  id: string;
  label: string;
  type: 'state' | 'event' | 'condition' | 'actor';
  description: string;
  position: { x: number; y: number };
  actor_leverage: number;
  stability: number;
  constraint_level: number;
  locked: boolean;
}

// ---------------------------------------------------------------------------
// Edge — propagation cost + openness (NOT a simple weight)
// ---------------------------------------------------------------------------
export interface CausalEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  propagation_cost: number;
  openness: number;
}

export interface CausalGraph {
  id: string;
  name: string;
  description: string;
  nodes: CausalNode[];
  edges: CausalEdge[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// System state (global variables)
// ---------------------------------------------------------------------------
export interface SystemState {
  pressure: number;
  constraint: number;
  recovery_capacity: number;
  thresholds: {
    lock: number;
    cascade: number;
    collapse: number;
  };
  status: 'active' | 'cascade' | 'collapsed';
}

// ---------------------------------------------------------------------------
// Step record
// ---------------------------------------------------------------------------
export type EdgeOutcome =
  | 'success'
  | 'propagation_failure'
  | 'correction_failure'
  | 'distortion_failure';

export type StepOutcome = EdgeOutcome | 'cascade' | 'collapse';

export interface EdgeResult {
  edge_id: string;
  outcome: EdgeOutcome;
  propagation_potential: number;
  constraint_delta: number;
}

export interface NodeDelta {
  node_id: string;
  stability_before: number;
  stability_after: number;
  constraint_before: number;
  constraint_after: number;
  locked_before: boolean;
  locked_after: boolean;
}

export interface NodeState {
  stability: number;
  constraint_level: number;
  locked: boolean;
}

export interface SimulationStep {
  step: number;
  action: {
    source_node_id: string;
    actor_leverage: number;
  };
  system_state_before: SystemState;
  system_state_after: SystemState;
  edge_results: EdgeResult[];
  node_deltas: NodeDelta[];
  step_outcome: StepOutcome;
  timestamp: string;
}

export interface SimulationState {
  id: string;
  graphId: string;
  step: number;
  system: SystemState;
  node_states: Record<string, NodeState>;
  trace: SimulationStep[];
  status: 'active' | 'cascade' | 'collapsed';
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Research / chat
// ---------------------------------------------------------------------------
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ResearchSession {
  id: string;
  name: string;
  messages: Message[];
  graphId?: string;
  createdAt: string;
  updatedAt: string;
}
