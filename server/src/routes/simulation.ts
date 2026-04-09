import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateGraphBodySchema,
  UpdateGraphBodySchema,
  SimulateBodySchema,
  CausalGraph,
  SimulationState,
} from '../validation/schemas';
import { readAll, readOne, writeOne, deleteOne } from '../storage/jsonStorage';
import {
  buildInitialSystemState,
  buildInitialNodeStates,
  runStep,
} from '../engine/riverthornEngine';

export const simulationRouter = Router();

// ---------------------------------------------------------------------------
// Graph CRUD
// ---------------------------------------------------------------------------

simulationRouter.get('/graphs', (_req: Request, res: Response) => {
  const graphs = readAll<CausalGraph>('graphs');
  res.json(graphs);
});

simulationRouter.post('/graphs', (req: Request, res: Response) => {
  const parse = CreateGraphBodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }
  const now = new Date().toISOString();
  const graph: CausalGraph = {
    id: uuidv4(),
    name: parse.data.name,
    description: parse.data.description,
    nodes: parse.data.nodes || [],
    edges: parse.data.edges || [],
    createdAt: now,
    updatedAt: now,
  };
  writeOne('graphs', graph.id, graph);
  res.status(201).json(graph);
});

simulationRouter.get('/graphs/:id', (req: Request, res: Response) => {
  const graph = readOne<CausalGraph>('graphs', req.params.id);
  if (!graph) {
    res.status(404).json({ error: 'Graph not found' });
    return;
  }
  res.json(graph);
});

simulationRouter.put('/graphs/:id', (req: Request, res: Response) => {
  const graph = readOne<CausalGraph>('graphs', req.params.id);
  if (!graph) {
    res.status(404).json({ error: 'Graph not found' });
    return;
  }
  const parse = UpdateGraphBodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }
  const updated: CausalGraph = {
    ...graph,
    ...parse.data,
    updatedAt: new Date().toISOString(),
  };
  writeOne('graphs', updated.id, updated);
  res.json(updated);
});

simulationRouter.delete('/graphs/:id', (req: Request, res: Response) => {
  const graph = readOne<CausalGraph>('graphs', req.params.id);
  if (!graph) {
    res.status(404).json({ error: 'Graph not found' });
    return;
  }
  deleteOne('graphs', req.params.id);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Simulation — step execution
// ---------------------------------------------------------------------------

simulationRouter.post('/graphs/:id/simulate', (req: Request, res: Response) => {
  const graph = readOne<CausalGraph>('graphs', req.params.id);
  if (!graph) {
    res.status(404).json({ error: 'Graph not found' });
    return;
  }

  const parse = SimulateBodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const { source_node_id, actor_leverage, simId } = parse.data;
  const now = new Date().toISOString();

  // Load existing simulation or create a fresh one
  let simState: SimulationState | null =
    simId ? readOne<SimulationState>('simulations', simId) : null;

  if (!simState) {
    simState = {
      id: uuidv4(),
      graphId: graph.id,
      step: 0,
      system: buildInitialSystemState(),
      node_states: buildInitialNodeStates(graph.nodes),
      trace: [],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
  }

  // Execute one propagation step via the RiverThorn engine
  const updated = runStep(graph, simState, { source_node_id, actor_leverage });

  writeOne('simulations', updated.id, updated);
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Simulation — query / delete
// ---------------------------------------------------------------------------

simulationRouter.get('/graphs/:id/simulations', (req: Request, res: Response) => {
  const allSims = readAll<SimulationState>('simulations');
  const filtered = allSims.filter(s => s.graphId === req.params.id);
  res.json(filtered);
});

simulationRouter.get('/simulations/:simId', (req: Request, res: Response) => {
  const sim = readOne<SimulationState>('simulations', req.params.simId);
  if (!sim) {
    res.status(404).json({ error: 'Simulation not found' });
    return;
  }
  res.json(sim);
});

simulationRouter.delete('/simulations/:simId', (req: Request, res: Response) => {
  const sim = readOne<SimulationState>('simulations', req.params.simId);
  if (!sim) {
    res.status(404).json({ error: 'Simulation not found' });
    return;
  }
  deleteOne('simulations', sim.id);
  res.status(204).send();
});
