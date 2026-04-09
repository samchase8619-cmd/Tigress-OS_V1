import { z } from 'zod';

export const CausalNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['state', 'event', 'condition']),
  description: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  attributes: z.record(z.union([z.string(), z.number(), z.boolean()])),
});

export const CausalEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string(),
  strength: z.number().min(0).max(1),
  conditions: z.array(z.string()),
});

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

export const SimulationStepSchema = z.object({
  step: z.number(),
  activatedNodes: z.array(z.string()),
  firedEdges: z.array(z.string()),
  timestamp: z.string(),
});

export const SimulationStateSchema = z.object({
  id: z.string(),
  graphId: z.string(),
  step: z.number(),
  activeNodes: z.array(z.string()),
  trace: z.array(SimulationStepSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

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

export type CausalNode = z.infer<typeof CausalNodeSchema>;
export type CausalEdge = z.infer<typeof CausalEdgeSchema>;
export type CausalGraph = z.infer<typeof CausalGraphSchema>;
export type CreateGraphBody = z.infer<typeof CreateGraphBodySchema>;
export type UpdateGraphBody = z.infer<typeof UpdateGraphBodySchema>;
export type SimulationStep = z.infer<typeof SimulationStepSchema>;
export type SimulationState = z.infer<typeof SimulationStateSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type ResearchSession = z.infer<typeof ResearchSessionSchema>;
export type CreateSessionBody = z.infer<typeof CreateSessionBodySchema>;
export type ChatBody = z.infer<typeof ChatBodySchema>;
