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
// Simulation state
// ---------------------------------------------------------------------------
export const SimulationStateSchema = z.object({
  id: z.string(),
  graphId: z.string(),
  step: z.number(),
  system: SystemStateSchema,
  node_states: z.record(NodeStateSchema),
  trace: z.array(SimulationStepSchema),
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
export type SimulationState = z.infer<typeof SimulationStateSchema>;
export type CreateGraphBody = z.infer<typeof CreateGraphBodySchema>;
export type UpdateGraphBody = z.infer<typeof UpdateGraphBodySchema>;
export type SimulateBody = z.infer<typeof SimulateBodySchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ResearchSession = z.infer<typeof ResearchSessionSchema>;
export type CreateSessionBody = z.infer<typeof CreateSessionBodySchema>;
export type ChatBody = z.infer<typeof ChatBodySchema>;
