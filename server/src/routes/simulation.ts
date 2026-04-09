import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateGraphBodySchema,
  UpdateGraphBodySchema,
  SimulateBodySchema,
  CausalGraph,
  CausalNode,
  CausalEdge,
  SimulationState,
  SystemState,
  NodeState,
  TestCaseResult,
  TestCasesResponse,
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
      turn_log: [],
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
// Simulation — query / delete / turn_log
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

/**
 * GET /api/simulation/simulations/:simId/turn_log
 * Returns just the turn_log array for a simulation — full per-turn visibility
 * with perceived_state, actual_state, selected_action, propagation_result,
 * system variable deltas, and triggered failures.
 */
simulationRouter.get('/simulations/:simId/turn_log', (req: Request, res: Response) => {
  const sim = readOne<SimulationState>('simulations', req.params.simId);
  if (!sim) {
    res.status(404).json({ error: 'Simulation not found' });
    return;
  }
  res.json(sim.turn_log ?? []);
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

// ---------------------------------------------------------------------------
// Test-case runner — deterministic, in-memory, never persisted
// ---------------------------------------------------------------------------
// Fixed RNG: always returns 0.5. Since all three failure cases are constructed
// so that propagation_potential <= 0, the RNG is irrelevant for outcome
// classification (it only matters for the statistical-failure branch when P>0).
const FIXED_RNG = () => 0.5;

/** Build a minimal SimulationState for in-memory test execution. */
function buildTestSimState(
  graph: CausalGraph,
  systemOverride: Pick<SystemState, 'pressure' | 'constraint' | 'recovery_capacity'>,
  nodeStateOverrides: Record<string, Partial<NodeState>>
): SimulationState {
  const now = new Date().toISOString();
  const baseNodeStates = buildInitialNodeStates(graph.nodes);
  const nodeStates: Record<string, NodeState> = {};
  for (const id of Object.keys(baseNodeStates)) {
    nodeStates[id] = { ...baseNodeStates[id], ...(nodeStateOverrides[id] ?? {}) };
  }
  return {
    id: `test-${uuidv4()}`,
    graphId: graph.id,
    step: 0,
    system: {
      pressure: systemOverride.pressure,
      constraint: systemOverride.constraint,
      recovery_capacity: systemOverride.recovery_capacity,
      thresholds: { lock: 0.7, cascade: 0.6, collapse: 0.9 },
      status: 'active',
    },
    node_states: nodeStates,
    trace: [],
    turn_log: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * POST /api/simulation/test-case
 *
 * Runs 3 deterministic controlled simulations in-memory. Results are never
 * persisted. The RNG is fixed at 0.5 for full reproducibility.
 *
 * Cases:
 *  1. PROPAGATION FAILURE — low leverage, high-constraint target (locked zone)
 *  2. CORRECTION FAILURE  — valid leverage but pressure already inverts action
 *  3. DISTORTION FAILURE  — moderate constraint; perceived != actual (AEIC gap)
 */
simulationRouter.post('/test-case', (_req: Request, res: Response) => {
  const now = new Date().toISOString();

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------
  function makeNode(
    id: string,
    label: string,
    type: CausalNode['type'],
    actorLeverage: number,
    stability: number,
    constraintLevel: number,
    locked = false
  ): CausalNode {
    return {
      id, label, type, description: label,
      position: { x: 0, y: 0 },
      actor_leverage: actorLeverage,
      stability,
      constraint_level: constraintLevel,
      locked,
    };
  }

  function makeEdge(
    id: string, source: string, target: string, label: string,
    propagationCost: number, openness: number
  ): CausalEdge {
    return { id, source, target, label, propagation_cost: propagationCost, openness };
  }

  // =========================================================================
  // CASE 1: PROPAGATION FAILURE
  // Setup: actor leverage = 0.1 (very low), target constraint_level = 0.62
  //   (>= lock*0.85 = 0.595). Even though the system is not under pressure,
  //   the target node is so constrained it blocks propagation structurally.
  //
  //   P_raw = 0.1 - 0.62 - 0.3 - 0.325 = -1.145
  //   P     = -1.145 * 0.8 = -0.916   (P <= 0)
  //   classifyFailure: target.constraint(0.62) >= lock*0.85(0.595) → propagation_failure
  //
  // AEIC discrepancy: actual constraint=0.62, perceived=0.60 (rounded to 0.05).
  // Actor believes the target has constraint 0.60 — just below the 0.595 danger
  // zone. In reality it is 0.62, already past it.
  // =========================================================================
  const g1Nodes = [
    makeNode('n1', 'Actor (source)', 'actor', 0.1, 1.0, 0.0),
    makeNode('n2', 'Target (high constraint)', 'state', 0.5, 0.5, 0.62),
  ];
  const g1Edges = [makeEdge('e1', 'n1', 'n2', 'apply pressure', 0.3, 0.8)];
  const graph1: CausalGraph = {
    id: 'tc-1', name: 'Propagation Failure Test', description: '',
    nodes: g1Nodes, edges: g1Edges,
    createdAt: now, updatedAt: now,
  };
  // pressure = mean(0.0 + 0.62) / 2 = 0.31
  const sim1 = buildTestSimState(graph1,
    { pressure: 0.31, constraint: 0.31, recovery_capacity: 0.8 },
    {}
  );
  const afterStep1 = runStep(graph1, sim1, { source_node_id: 'n1', actor_leverage: 0.1 }, FIXED_RNG);
  const tl1 = afterStep1.turn_log[0];
  const actualOutcome1 = tl1?.propagation_result.outcome ?? 'unknown';

  const case1: TestCaseResult = {
    case_id: 'propagation_failure',
    description:
      'Low actor leverage (0.10) against a target whose constraint_level (0.62) exceeds the ' +
      'lock*0.85 danger threshold (0.595). Action is formally correct but structurally blocked. ' +
      'AEIC shows constraint as 0.60 — the actor believes the node is marginally safe; ' +
      'the reality is 0.62, already in the locked zone.',
    setup: {
      nodes: [
        { id: 'n1', label: 'Actor (source)', role: 'source', constraint_level: 0.0, actor_leverage: 0.1, locked: false },
        { id: 'n2', label: 'Target (high constraint)', role: 'target', constraint_level: 0.62, actor_leverage: 0.5, locked: false },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', propagation_cost: 0.3, openness: 0.8 }],
      system_pressure: 0.31,
      recovery_capacity: 0.8,
      actor_leverage_used: 0.1,
      why_this_fails:
        'P_raw = 0.10 − 0.62 − 0.30 − 0.31 = −1.13; P = −1.13 × 0.8 = −0.90. ' +
        'P ≤ 0 and target.constraint (0.62) ≥ lock×0.85 (0.595). ' +
        'Engine classifies as propagation_failure: structural block from over-constrained target.',
      expected_outcome: 'propagation_failure',
    },
    turn_log: afterStep1.turn_log,
    failure_flag: actualOutcome1 === 'propagation_failure',
    actual_outcome: actualOutcome1,
    cause_explanation: {
      formula_breakdown:
        'P_raw = actor_leverage(0.10) − target.constraint(0.62) − edge.cost(0.30) − pressure(0.31) = −1.13\n' +
        'P = P_raw × openness(0.80) = −0.90\n' +
        'Since P ≤ 0 and target.constraint(0.62) ≥ lock×0.85(0.595): outcome = propagation_failure',
      labeled_cause:
        'STRUCTURAL BLOCK — The target node constraint_level (0.62) has crossed the lock danger ' +
        'threshold (lock × 0.85 = 0.595). The actor\'s leverage is insufficient (0.10) to overcome ' +
        'the node\'s accumulated resistance even before edge cost and pressure are factored in.',
      aeic_discrepancy:
        'Perceived n2.constraint_level = 0.60 (AEIC rounds to nearest 0.05). ' +
        'Actual n2.constraint_level = 0.62. ' +
        'The 0.02 gap means the actor believes the target is just outside the danger zone ' +
        '(0.595) when it has already crossed it. The actor calibrated their action incorrectly.',
      recovery_note:
        'To succeed: raise actor_leverage above 0.62 + 0.30 + 0.31 = 1.23 (impossible in [0,1]) ' +
        'OR reduce n2.constraint_level below 0.595 before acting ' +
        'OR reduce system pressure so the edge path remains open.',
    },
  };

  // =========================================================================
  // CASE 2: CORRECTION FAILURE
  // Setup: actor leverage = 0.8 (high — this IS a "valid" intervention),
  //   but system pressure (0.50) is already above cascade×0.8 (0.48).
  //   The pressure inversion means the well-intentioned action makes things worse.
  //
  //   Nodes: n1(source, constraint=0.6), n2(target, constraint=0.4)
  //   Mean pressure = (0.6 + 0.4) / 2 = 0.50
  //
  //   P_raw = 0.8 - 0.4 - 0.2 - 0.50 = -0.30
  //   P     = -0.30 * 0.8 = -0.24   (P <= 0)
  //   classifyFailure: target.constraint(0.4) < lock*0.85(0.595) AND
  //                    pressure(0.5) >= cascade*0.8(0.48) → correction_failure
  //
  //   recovery_capacity is set to 0.1 to show the system has no buffer.
  // =========================================================================
  const g2Nodes = [
    makeNode('n1', 'High-pressure source', 'actor', 0.8, 0.5, 0.6),
    makeNode('n2', 'Intervention target', 'state', 0.5, 0.7, 0.4),
  ];
  const g2Edges = [makeEdge('e1', 'n1', 'n2', 'intervene', 0.2, 0.8)];
  const graph2: CausalGraph = {
    id: 'tc-2', name: 'Correction Failure Test', description: '',
    nodes: g2Nodes, edges: g2Edges,
    createdAt: now, updatedAt: now,
  };
  // pressure = mean(0.6 + 0.4) / 2 = 0.50; recovery_capacity = 0.1
  const sim2 = buildTestSimState(graph2,
    { pressure: 0.5, constraint: 0.5, recovery_capacity: 0.1 },
    {}
  );
  const afterStep2 = runStep(graph2, sim2, { source_node_id: 'n1', actor_leverage: 0.8 }, FIXED_RNG);
  const tl2 = afterStep2.turn_log[0];
  const actualOutcome2 = tl2?.propagation_result.outcome ?? 'unknown';

  const case2: TestCaseResult = {
    case_id: 'correction_failure',
    description:
      'Actor has strong leverage (0.80) — the action is formally correct. ' +
      'However system pressure (0.50) has already exceeded the cascade×0.8 inversion threshold (0.48). ' +
      'The system\'s recovery_capacity is 0.10, meaning it cannot absorb the correction. ' +
      'The intended change is neutralised and the target accumulates MORE constraint instead.',
    setup: {
      nodes: [
        { id: 'n1', label: 'High-pressure source', role: 'source', constraint_level: 0.6, actor_leverage: 0.8, locked: false },
        { id: 'n2', label: 'Intervention target', role: 'target', constraint_level: 0.4, actor_leverage: 0.5, locked: false },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', propagation_cost: 0.2, openness: 0.8 }],
      system_pressure: 0.5,
      recovery_capacity: 0.1,
      actor_leverage_used: 0.8,
      why_this_fails:
        'P_raw = 0.80 − 0.40 − 0.20 − 0.50 = −0.30; P = −0.30 × 0.8 = −0.24. ' +
        'P ≤ 0 but target.constraint (0.40) is below lock×0.85 (0.595). ' +
        'System pressure (0.50) ≥ cascade×0.8 (0.48). ' +
        'Engine classifies as correction_failure: pressure inversion absorbed the intervention.',
      expected_outcome: 'correction_failure',
    },
    turn_log: afterStep2.turn_log,
    failure_flag: actualOutcome2 === 'correction_failure',
    actual_outcome: actualOutcome2,
    cause_explanation: {
      formula_breakdown:
        'P_raw = actor_leverage(0.80) − target.constraint(0.40) − edge.cost(0.20) − pressure(0.50) = −0.30\n' +
        'P = P_raw × openness(0.80) = −0.24\n' +
        'Since P ≤ 0 and pressure(0.50) ≥ cascade×0.8(0.48): outcome = correction_failure\n' +
        'failure_probability = max(0, 0.50 − 0.10) × 0.4 = 0.16 (irrelevant because P ≤ 0)',
      labeled_cause:
        'PRESSURE INVERSION — System pressure (0.50) has crossed the cascade inversion threshold ' +
        '(0.48). Even though the actor\'s leverage is strong (0.80), the system pressure ' +
        'exceeds the sum of leverage minus costs. The correction does not land; instead it ' +
        'adds +0.08 constraint to the target and raises system pressure by +0.03. ' +
        'recovery_capacity (0.10) is far too low to absorb shocks.',
      aeic_discrepancy:
        'Perceived pressure = 0.50 (AEIC rounds to 0.05, no gap here). ' +
        'However recovery_capacity (0.10) is HIDDEN from the actor entirely ' +
        '(recovery_capacity_visible = false). The actor cannot see that the system has ' +
        'almost no buffer, so they cannot know that their correct action will be inverted.',
      recovery_note:
        'To succeed: reduce system pressure below cascade×0.8 (0.48) before acting ' +
        'OR increase recovery_capacity above pressure (0.50) to reduce failure_probability ' +
        'OR reduce edge cost and target constraint so P_raw becomes positive.',
    },
  };

  // =========================================================================
  // CASE 3: DISTORTION FAILURE
  // Setup: actor leverage = 0.5 (moderate), target constraint_level = 0.43.
  //   Pressure = 0.43 (below cascade×0.8 = 0.48 so NOT a correction failure).
  //   Target constraint < lock×0.85 (0.595) so NOT a propagation failure.
  //   → distortion_failure: action reaches the node but is absorbed, not causal.
  //
  //   Nodes: n1(source, constraint=0.43), n2(target, constraint=0.43), n3(downstream, constraint=0.1)
  //   Mean pressure = (0.43+0.43+0.1)/3 ≈ 0.32 — I'll fix it at 0.43 manually so the
  //   formula clearly shows the distortion zone.
  //
  //   P_raw = 0.5 - 0.43 - 0.3 - 0.43 = -0.66
  //   P     = -0.66 * 0.7 = -0.462   (P <= 0)
  //   classifyFailure: target.constraint(0.43) < 0.595 AND pressure(0.43) < 0.48
  //                    → distortion_failure
  //
  // AEIC discrepancy: actual constraint=0.43 → perceived=0.45 (rounds up).
  //   Actor sees target at 0.45 and pressure at 0.45 — both over-estimated.
  //   They calibrate their action for a harder target than exists, misapply leverage.
  // =========================================================================
  const g3Nodes = [
    makeNode('n1', 'Actor (moderate leverage)', 'actor', 0.5, 0.7, 0.43),
    makeNode('n2', 'Distorted target', 'state', 0.5, 0.8, 0.43),
    makeNode('n3', 'Downstream node (spill)', 'state', 0.5, 1.0, 0.1),
  ];
  const g3Edges = [
    makeEdge('e1', 'n1', 'n2', 'apply correction', 0.3, 0.7),
    makeEdge('e2', 'n2', 'n3', 'downstream channel', 0.2, 0.6),
  ];
  const graph3: CausalGraph = {
    id: 'tc-3', name: 'Distortion Failure Test', description: '',
    nodes: g3Nodes, edges: g3Edges,
    createdAt: now, updatedAt: now,
  };
  // Fix system pressure to 0.43 (in the distortion zone: below cascade×0.8=0.48)
  const sim3 = buildTestSimState(graph3,
    { pressure: 0.43, constraint: 0.43, recovery_capacity: 0.6 },
    {}
  );
  const afterStep3 = runStep(graph3, sim3, { source_node_id: 'n1', actor_leverage: 0.5 }, FIXED_RNG);
  const tl3 = afterStep3.turn_log[0];
  const actualOutcome3 = tl3?.propagation_result.outcome ?? 'unknown';

  const case3: TestCaseResult = {
    case_id: 'distortion_failure',
    description:
      'Actor has moderate leverage (0.50) against a target with constraint_level 0.43. ' +
      'System pressure (0.43) is below the correction-failure threshold (0.48) and the target ' +
      'is not near lock. The action physically reaches the target but the energy is absorbed ' +
      'without causal effect — it distorts rather than propagates. ' +
      'Downstream node n3 receives a +0.02 constraint spill. ' +
      'AEIC overestimates both constraint and pressure (0.43 → 0.45), causing the actor ' +
      'to believe the environment is harder than it is and misapply their leverage.',
    setup: {
      nodes: [
        { id: 'n1', label: 'Actor (moderate leverage)', role: 'source', constraint_level: 0.43, actor_leverage: 0.5, locked: false },
        { id: 'n2', label: 'Distorted target', role: 'target', constraint_level: 0.43, actor_leverage: 0.5, locked: false },
        { id: 'n3', label: 'Downstream node (spill)', role: 'downstream', constraint_level: 0.1, actor_leverage: 0.5, locked: false },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', propagation_cost: 0.3, openness: 0.7 },
        { id: 'e2', source: 'n2', target: 'n3', propagation_cost: 0.2, openness: 0.6 },
      ],
      system_pressure: 0.43,
      recovery_capacity: 0.6,
      actor_leverage_used: 0.5,
      why_this_fails:
        'P_raw = 0.50 − 0.43 − 0.30 − 0.43 = −0.66; P = −0.66 × 0.7 = −0.462. ' +
        'P ≤ 0 and target.constraint(0.43) < lock×0.85(0.595) ' +
        'and pressure(0.43) < cascade×0.8(0.48). ' +
        'Engine classifies as distortion_failure: energy absorbed without causal propagation; ' +
        'downstream n3 receives constraint spill.',
      expected_outcome: 'distortion_failure',
    },
    turn_log: afterStep3.turn_log,
    failure_flag: actualOutcome3 === 'distortion_failure',
    actual_outcome: actualOutcome3,
    cause_explanation: {
      formula_breakdown:
        'P_raw = actor_leverage(0.50) − target.constraint(0.43) − edge.cost(0.30) − pressure(0.43) = −0.66\n' +
        'P = P_raw × openness(0.70) = −0.462\n' +
        'Since P ≤ 0 and target.constraint(0.43) < lock×0.85(0.595) ' +
        'and pressure(0.43) < cascade×0.8(0.48): outcome = distortion_failure\n' +
        'Effect: n2.constraint += 0.10, n2.stability −= 0.03, n3.constraint += 0.02 (spill)',
      labeled_cause:
        'DISTORTION — The action was not strong enough to overcome the combined resistance ' +
        '(target constraint + edge cost + system pressure). The total resistance (0.43+0.30+0.43=1.16) ' +
        'exceeds the actor\'s leverage (0.50). The energy is absorbed by the target and radiates ' +
        'downstream as uncontrolled constraint spill, making the situation worse without ' +
        'achieving the intended causal change.',
      aeic_discrepancy:
        'Perceived n2.constraint_level = 0.45 (AEIC rounds 0.43 → 0.45 to nearest 0.05). ' +
        'Actual n2.constraint_level = 0.43. ' +
        'Perceived system.pressure = 0.45 (rounds 0.43 → 0.45). ' +
        'Actual system.pressure = 0.43. ' +
        'The actor overestimates both the target\'s resistance and system pressure by +0.02 each. ' +
        'They believe they need leverage > 0.45+0.30+0.45 = 1.20 to succeed — which appears ' +
        'impossible — when in reality they need > 0.43+0.30+0.43 = 1.16 (still impossible at 0.50, ' +
        'but the AEIC gap distorts their model of the situation).',
      recovery_note:
        'To succeed: raise actor_leverage above target.constraint + edge.cost + pressure = 1.16 ' +
        '(impossible at max leverage 1.0 with current graph). ' +
        'Correct path: reduce n2.constraint_level below 0.20 (then P_raw > 0) ' +
        'OR reduce edge.cost + pressure below leverage−constraint first ' +
        'OR use a different source node with higher leverage.',
    },
  };

  const response: TestCasesResponse = {
    generated_at: now,
    rng_mode: 'deterministic',
    cases: [case1, case2, case3],
  };

  res.json(response);
});
