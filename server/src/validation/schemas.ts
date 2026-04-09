import { z } from 'zod';

// ---------------------------------------------------------------------------
// Node — carries live simulation state fields per GAME_ENGINE.yaml
// ---------------------------------------------------------------------------
export const CausalNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['state', 'event', 'condition', 'actor']),
  description: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  // RiverThorn system properties
  actor_leverage: z.number().min(0).max(1).default(0.5),
  stability: z.number().min(0).max(1).default(1.0),
  constraint_level: z.number().min(0).max(1).default(0.0),
  locked: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Edge — propagation_cost + openness replace the old binary strength
// ---------------------------------------------------------------------------
export const CausalEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string(),
  propagation_cost: z.number().min(0).max(1).default(0.3),
  openness: z.number().min(0).max(1).default(0.7),
});

// ---------------------------------------------------------------------------
// System state (global variables)
// ---------------------------------------------------------------------------
export const SystemStateSchema = z.object({
  pressure: z.number().min(0).max(1),
  constraint: z.number().min(0).max(1),
  recovery_capacity: z.number().min(0).max(1),
  thresholds: z.object({
    lock: z.number().min(0).max(1),
    cascade: z.number().min(0).max(1),
    collapse: z.number().min(0).max(1),
  }),
  status: z.enum(['active', 'cascade', 'collapsed']),
});

// ---------------------------------------------------------------------------
// Step record — full accounting of one propagation step
// ---------------------------------------------------------------------------
export const EdgeResultSchema = z.object({
  edge_id: z.string(),
  outcome: z.enum(['success', 'propagation_failure', 'correction_failure', 'distortion_failure']),
  propagation_potential: z.number(),
  constraint_delta: z.number(),
});

export const NodeDeltaSchema = z.object({
  node_id: z.string(),
  stability_before: z.number(),
  stability_after: z.number(),
  constraint_before: z.number(),
  constraint_after: z.number(),
  locked_before: z.boolean(),
  locked_after: z.boolean(),
});

export const SimulationStepSchema = z.object({
  step: z.number(),
  action: z.object({
    source_node_id: z.string(),
    actor_leverage: z.number(),
  }),
  system_state_before: SystemStateSchema,
  system_state_after: SystemStateSchema,
  edge_results: z.array(EdgeResultSchema),
  node_deltas: z.array(NodeDeltaSchema),
  step_outcome: z.enum([
    'success',
    'propagation_failure',
    'correction_failure',
    'distortion_failure',
    'cascade',
    'collapse',
  ]),
  timestamp: z.string(),
});

// ---------------------------------------------------------------------------
// Node state snapshot stored in simulation (mirrors node live state)
// ---------------------------------------------------------------------------
export const NodeStateSchema = z.object({
  stability: z.number(),
  constraint_level: z.number(),
  locked: z.boolean(),
});

// ---------------------------------------------------------------------------
// AEIC — Actor Environmental Information Channel
// Perceived node state: what the actor observes (granularity-reduced, no
// direct read of exact internal values).
// ---------------------------------------------------------------------------
export const PerceivedNodeStateSchema = z.object({
  /** Stability visible only to 0.1 granularity. */
  stability: z.number(),
  /** Constraint level visible to 0.05 granularity with minor perturbation. */
  constraint_level: z.number(),
  /** Lock state is fully visible. */
  locked: z.boolean(),
});

export const PerceivedSystemStateSchema = z.object({
  /** Pressure visible to 0.05 granularity. */
  pressure: z.number(),
  /** Recovery capacity is NOT directly visible to the actor. */
  recovery_capacity_visible: z.literal(false),
  /** Status transition is visible. */
  status: z.enum(['active', 'cascade', 'collapsed']),
});

// ---------------------------------------------------------------------------
// Turn log — explicit per-turn visibility record
// ---------------------------------------------------------------------------

export const TriggeredFailureSchema = z.object({
  /** Which failure mode fired. */
  type: z.enum([
    'propagation_failure',
    'correction_failure',
    'distortion_failure',
    'cascade',
    'collapse',
  ]),
  /** Which edge triggered it (absent for system-level events). */
  edge_id: z.string().optional(),
  /** Which target node was affected (absent for system-level events). */
  target_node_id: z.string().optional(),
  /** Human-readable explanation. */
  reason: z.string(),
});

export const TurnLogEntrySchema = z.object({
  step: z.number(),
  timestamp: z.string(),

  /**
   * What the actor perceives BEFORE acting — AEIC-filtered view.
   * Granularity-reduced; recovery_capacity hidden.
   */
  perceived_state: z.object({
    node_states: z.record(PerceivedNodeStateSchema),
    system: PerceivedSystemStateSchema,
  }),

  /**
   * True system state BEFORE the action executes — hidden from actor.
   */
  actual_state: z.object({
    node_states: z.record(NodeStateSchema),
    system: SystemStateSchema,
  }),

  /** The action submitted by the actor. */
  selected_action: z.object({
    source_node_id: z.string(),
    actor_leverage: z.number(),
  }),

  /** Full propagation result. */
  propagation_result: z.object({
    outcome: z.enum([
      'success',
      'propagation_failure',
      'correction_failure',
      'distortion_failure',
      'cascade',
      'collapse',
    ]),
    /** Human-readable explanation of why this outcome occurred. */
    reason: z.string(),
    edge_results: z.array(EdgeResultSchema),
  }),

  /** System variable deltas (after − before). */
  recovery_capacity_change: z.number(),
  pressure_change: z.number(),
  constraint_change: z.number(),

  /** All discrete failure events that fired during this turn. */
  triggered_failures: z.array(TriggeredFailureSchema),
});

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------
export const SimulationStateSchema = z.object({
  id: z.string(),
  graphId: z.string(),
  step: z.number(),
  system: SystemStateSchema,
  node_states: z.record(NodeStateSchema),
  trace: z.array(SimulationStepSchema),
  /** Full per-turn log with perceived/actual states and failure details. */
  turn_log: z.array(TurnLogEntrySchema).default([]),
  status: z.enum(['active', 'cascade', 'collapsed']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ---------------------------------------------------------------------------
// Graph container
// ---------------------------------------------------------------------------
export const CausalGraphSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  nodes: z.array(CausalNodeSchema),
  edges: z.array(CausalEdgeSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateGraphBodySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  nodes: z.array(CausalNodeSchema).optional(),
  edges: z.array(CausalEdgeSchema).optional(),
});

export const UpdateGraphBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  nodes: z.array(CausalNodeSchema).optional(),
  edges: z.array(CausalEdgeSchema).optional(),
});

// ---------------------------------------------------------------------------
// Simulate action body
// ---------------------------------------------------------------------------
export const SimulateBodySchema = z.object({
  source_node_id: z.string(),
  actor_leverage: z.number().min(0).max(1).optional(),
  simId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Research / chat
// ---------------------------------------------------------------------------
export const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  timestamp: z.string(),
});

export const ResearchSessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  messages: z.array(MessageSchema),
  graphId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateSessionBodySchema = z.object({
  name: z.string().min(1),
  graphId: z.string().optional(),
});

export const ChatBodySchema = z.object({
  sessionId: z.string(),
  content: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Exported TypeScript types
// ---------------------------------------------------------------------------
export type CausalNode = z.infer<typeof CausalNodeSchema>;
export type CausalEdge = z.infer<typeof CausalEdgeSchema>;
export type CausalGraph = z.infer<typeof CausalGraphSchema>;
export type SystemState = z.infer<typeof SystemStateSchema>;
export type EdgeResult = z.infer<typeof EdgeResultSchema>;
export type NodeDelta = z.infer<typeof NodeDeltaSchema>;
export type NodeState = z.infer<typeof NodeStateSchema>;
export type SimulationStep = z.infer<typeof SimulationStepSchema>;
export type PerceivedNodeState = z.infer<typeof PerceivedNodeStateSchema>;
export type PerceivedSystemState = z.infer<typeof PerceivedSystemStateSchema>;
export type TriggeredFailure = z.infer<typeof TriggeredFailureSchema>;
export type TurnLogEntry = z.infer<typeof TurnLogEntrySchema>;
export type SimulationState = z.infer<typeof SimulationStateSchema>;
export type CreateGraphBody = z.infer<typeof CreateGraphBodySchema>;
export type UpdateGraphBody = z.infer<typeof UpdateGraphBodySchema>;
export type SimulateBody = z.infer<typeof SimulateBodySchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ResearchSession = z.infer<typeof ResearchSessionSchema>;
export type CreateSessionBody = z.infer<typeof CreateSessionBodySchema>;
export type ChatBody = z.infer<typeof ChatBodySchema>;
