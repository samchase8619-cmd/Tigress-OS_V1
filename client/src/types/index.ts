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

// ---------------------------------------------------------------------------
// AEIC — Actor Environmental Information Channel perceived state
// ---------------------------------------------------------------------------

/** What the actor perceives — granularity-reduced, recovery_capacity hidden. */
export interface PerceivedNodeState {
  /** Rounded to 0.1 granularity. */
  stability: number;
  /** Rounded to 0.05 granularity. */
  constraint_level: number;
  locked: boolean;
}

export interface PerceivedSystemState {
  /** Rounded to 0.05 granularity. */
  pressure: number;
  /** Always false — recovery_capacity is not visible to the actor. */
  recovery_capacity_visible: false;
  status: 'active' | 'cascade' | 'collapsed';
}

// ---------------------------------------------------------------------------
// Turn log — full per-turn visibility record
// ---------------------------------------------------------------------------

export interface TriggeredFailure {
  type: 'propagation_failure' | 'correction_failure' | 'distortion_failure' | 'cascade' | 'collapse';
  edge_id?: string;
  target_node_id?: string;
  reason: string;
}

export interface TurnLogEntry {
  step: number;
  timestamp: string;

  /** What the actor perceives BEFORE acting (AEIC-filtered). */
  perceived_state: {
    node_states: Record<string, PerceivedNodeState>;
    system: PerceivedSystemState;
  };

  /** True system state BEFORE the action — hidden from actor. */
  actual_state: {
    node_states: Record<string, NodeState>;
    system: SystemState;
  };

  /** The action submitted by the actor. */
  selected_action: {
    source_node_id: string;
    actor_leverage: number;
  };

  /** Full propagation result with reason string. */
  propagation_result: {
    outcome: StepOutcome;
    reason: string;
    edge_results: EdgeResult[];
  };

  /** System variable deltas (after − before). */
  recovery_capacity_change: number;
  pressure_change: number;
  constraint_change: number;

  /** All discrete failure events that fired during this turn. */
  triggered_failures: TriggeredFailure[];
}

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------
export interface SimulationState {
  id: string;
  graphId: string;
  step: number;
  system: SystemState;
  node_states: Record<string, NodeState>;
  trace: SimulationStep[];
  turn_log: TurnLogEntry[];
  status: 'active' | 'cascade' | 'collapsed';
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Test-case types
// ---------------------------------------------------------------------------

export interface TestCaseNodeSetup {
  id: string;
  label: string;
  role: 'source' | 'target' | 'background' | 'downstream';
  constraint_level: number;
  actor_leverage: number;
  locked: boolean;
}

export interface TestCaseSetup {
  nodes: TestCaseNodeSetup[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    propagation_cost: number;
    openness: number;
  }>;
  system_pressure: number;
  recovery_capacity: number;
  actor_leverage_used: number;
  why_this_fails: string;
  expected_outcome: 'propagation_failure' | 'correction_failure' | 'distortion_failure';
}

export interface TestCaseCauseExplanation {
  formula_breakdown: string;
  labeled_cause: string;
  aeic_discrepancy: string | null;
  recovery_note: string;
}

export interface TestCaseResult {
  case_id: 'propagation_failure' | 'correction_failure' | 'distortion_failure';
  description: string;
  setup: TestCaseSetup;
  turn_log: TurnLogEntry[];
  failure_flag: boolean;
  actual_outcome: string;
  cause_explanation: TestCaseCauseExplanation;
}

export interface TestCasesResponse {
  generated_at: string;
  rng_mode: 'deterministic';
  cases: TestCaseResult[];
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
