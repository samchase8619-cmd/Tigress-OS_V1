export interface CausalNode {
  id: string;
  label: string;
  type: 'state' | 'event' | 'condition';
  description: string;
  position: { x: number; y: number };
  attributes: Record<string, string | number | boolean>;
}

export interface CausalEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  strength: number;
  conditions: string[];
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

export interface SimulationStep {
  step: number;
  activatedNodes: string[];
  firedEdges: string[];
  timestamp: string;
}

export interface SimulationState {
  id: string;
  graphId: string;
  step: number;
  activeNodes: string[];
  trace: SimulationStep[];
  createdAt: string;
  updatedAt: string;
}

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
