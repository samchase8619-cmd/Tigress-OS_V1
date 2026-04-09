import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateGraphBodySchema,
  UpdateGraphBodySchema,
  CausalGraph,
  SimulationState,
} from '../validation/schemas';
import { readAll, readOne, writeOne, deleteOne } from '../storage/jsonStorage';

export const simulationRouter = Router();

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

simulationRouter.post('/graphs/:id/simulate', (req: Request, res: Response) => {
  const graph = readOne<CausalGraph>('graphs', req.params.id);
  if (!graph) {
    res.status(404).json({ error: 'Graph not found' });
    return;
  }

  const simId = req.body.simId as string | undefined;
  let simState: SimulationState | null = simId ? readOne<SimulationState>('simulations', simId) : null;

  const now = new Date().toISOString();

  if (!simState) {
    const seedNodes = (req.body.activeNodes as string[] | undefined) ||
      (graph.nodes.length > 0 ? [graph.nodes[0].id] : []);
    simState = {
      id: uuidv4(),
      graphId: graph.id,
      step: 0,
      activeNodes: seedNodes,
      trace: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  const currentActive = simState.activeNodes;
  const firedEdges: string[] = [];
  const nextActive: Set<string> = new Set();

  for (const edge of graph.edges) {
    if (currentActive.includes(edge.source) && edge.strength > 0.5) {
      firedEdges.push(edge.id);
      nextActive.add(edge.target);
    }
  }

  const newStep = {
    step: simState.step + 1,
    activatedNodes: Array.from(nextActive),
    firedEdges,
    timestamp: now,
  };

  const updatedSim: SimulationState = {
    ...simState,
    step: simState.step + 1,
    activeNodes: nextActive.size > 0 ? Array.from(nextActive) : currentActive,
    trace: [...simState.trace, newStep],
    updatedAt: now,
  };

  writeOne('simulations', updatedSim.id, updatedSim);
  res.json(updatedSim);
});

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
  deleteOne('simulations', req.params.simId);
  res.status(204).send();
});
