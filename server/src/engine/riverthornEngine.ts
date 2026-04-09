/**
 * RiverThorn Simulation Engine
 * Implements the propagation algorithm defined in docs/GAME_ENGINE.yaml.
 *
 * Key rules (never violate):
 *  - No HP, no damage model, no combat loop.
 *  - Board is causal structure, not flavor.
 *  - Propagation depends on: actor leverage, node constraint, edge propagation
 *    cost, and global pressure.
 *  - Propagation CAN fail even when the action is formally correct.
 */

import type {
  CausalGraph,
  CausalNode,
  CausalEdge,
  SystemState,
  SimulationState,
  SimulationStep,
  EdgeResult,
  NodeDelta,
  NodeState,
} from '../validation/schemas';

// ---------------------------------------------------------------------------
// Constants (from GAME_ENGINE.yaml)
// ---------------------------------------------------------------------------

/** Maximum statistical failure probability when pressure fully exceeds recovery capacity. */
const MAX_FAILURE_PROBABILITY = 0.4;
const DEFAULT_THRESHOLDS = {
  lock: 0.7,
  cascade: 0.6,
  collapse: 0.9,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

/** Build the initial system state for a brand-new simulation. */
export function buildInitialSystemState(): SystemState {
  return {
    pressure: 0.1,
    constraint: 0.1,
    recovery_capacity: 0.8,
    thresholds: { ...DEFAULT_THRESHOLDS },
    status: 'active',
  };
}

/** Build the initial node_states map from a graph's nodes. */
export function buildInitialNodeStates(
  nodes: CausalNode[]
): Record<string, NodeState> {
  const map: Record<string, NodeState> = {};
  for (const n of nodes) {
    map[n.id] = {
      stability: n.stability,
      constraint_level: n.constraint_level,
      locked: n.locked,
    };
  }
  return map;
}

/** Recompute system pressure as mean of all node constraint_levels. */
function recomputePressure(
  nodeStates: Record<string, NodeState>
): number {
  const ids = Object.keys(nodeStates);
  if (ids.length === 0) return 0;
  const total = ids.reduce((sum, id) => sum + nodeStates[id].constraint_level, 0);
  return clamp(total / ids.length);
}

/** Determine simulation status from current pressure and thresholds. */
function computeStatus(
  pressure: number,
  thresholds: SystemState['thresholds']
): SystemState['status'] {
  if (pressure >= thresholds.collapse) return 'collapsed';
  if (pressure >= thresholds.cascade) return 'cascade';
  return 'active';
}

// ---------------------------------------------------------------------------
// Failure mode classification (per GAME_ENGINE.yaml outcome_rules)
// ---------------------------------------------------------------------------

type EdgeOutcome = EdgeResult['outcome'];

function classifyFailure(
  potential: number,
  target: NodeState,
  system: SystemState
): EdgeOutcome {
  const { lock, cascade } = system.thresholds;

  if (target.constraint_level >= lock * 0.85) {
    return 'propagation_failure';
  }
  if (system.pressure >= cascade * 0.8) {
    return 'correction_failure';
  }
  return 'distortion_failure';
}

// ---------------------------------------------------------------------------
// Core: run one propagation step
// ---------------------------------------------------------------------------

export interface StepAction {
  source_node_id: string;
  actor_leverage?: number;
}

export function runStep(
  graph: CausalGraph,
  simState: SimulationState,
  action: StepAction,
  rng: () => number = Math.random
): SimulationState {
  const now = new Date().toISOString();
  const { thresholds } = simState.system;

  // --- guard: collapsed systems cannot propagate ---
  if (simState.status === 'collapsed') {
    const collapseStep: SimulationStep = {
      step: simState.step + 1,
      action: {
        source_node_id: action.source_node_id,
        actor_leverage: 0,
      },
      system_state_before: { ...simState.system },
      system_state_after: { ...simState.system },
      edge_results: [],
      node_deltas: [],
      step_outcome: 'collapse',
      timestamp: now,
    };
    return {
      ...simState,
      step: simState.step + 1,
      trace: [...simState.trace, collapseStep],
      updatedAt: now,
    };
  }

  // --- snapshot system state before ---
  const systemBefore: SystemState = { ...simState.system, thresholds: { ...thresholds } };

  // --- mutable working copies ---
  const nodeStates: Record<string, NodeState> = {};
  for (const id of Object.keys(simState.node_states)) {
    nodeStates[id] = { ...simState.node_states[id] };
  }
  let sys: SystemState = { ...simState.system, thresholds: { ...thresholds } };

  // --- resolve actor leverage ---
  const sourceNode = graph.nodes.find((n: CausalNode) => n.id === action.source_node_id);
  const actorLeverage = action.actor_leverage ??
    (sourceNode?.actor_leverage ?? 0.5);

  // --- guard: source node must exist and not be locked ---
  if (!sourceNode || (nodeStates[action.source_node_id]?.locked ?? false)) {
    const blockedStep: SimulationStep = {
      step: simState.step + 1,
      action: { source_node_id: action.source_node_id, actor_leverage: actorLeverage },
      system_state_before: systemBefore,
      system_state_after: systemBefore,
      edge_results: [],
      node_deltas: [],
      step_outcome: 'propagation_failure',
      timestamp: now,
    };
    return {
      ...simState,
      step: simState.step + 1,
      trace: [...simState.trace, blockedStep],
      updatedAt: now,
    };
  }

  // --- process each outgoing edge ---
  const outgoing: CausalEdge[] = graph.edges.filter(
    (e: CausalEdge) => e.source === action.source_node_id
  );

  const edgeResults: EdgeResult[] = [];
  const nodeDeltaMap: Map<string, NodeDelta> = new Map();

  // Snapshot "before" for all nodes that may be touched
  const snapshotBefore = (id: string): void => {
    if (!nodeDeltaMap.has(id)) {
      const s = nodeStates[id] ?? { stability: 1.0, constraint_level: 0.0, locked: false };
      nodeDeltaMap.set(id, {
        node_id: id,
        stability_before: s.stability,
        stability_after: s.stability,
        constraint_before: s.constraint_level,
        constraint_after: s.constraint_level,
        locked_before: s.locked,
        locked_after: s.locked,
      });
    }
  };

  for (const edge of outgoing) {
    const targetId = edge.target;
    const target = nodeStates[targetId];

    // Missing target node — skip silently
    if (!target) continue;

    snapshotBefore(targetId);

    // Locked target → propagation_failure immediately
    if (target.locked) {
      edgeResults.push({
        edge_id: edge.id,
        outcome: 'propagation_failure',
        propagation_potential: 0,
        constraint_delta: 0,
      });
      continue;
    }

    // --- potential formula (GAME_ENGINE.yaml) ---
    const pRaw =
      actorLeverage -
      target.constraint_level -
      edge.propagation_cost -
      sys.pressure;
    const potential = pRaw * edge.openness;

    // --- failure probability (GAME_ENGINE.yaml) ---
    const failureProb = clamp(sys.pressure - sys.recovery_capacity) * MAX_FAILURE_PROBABILITY;

    // Single RNG roll — compare once for mutual exclusivity
    const roll = rng();

    let outcome: EdgeOutcome;
    let constraintDelta = 0;

    if (potential > 0 && roll >= failureProb) {
      // SUCCESS
      outcome = 'success';
      const stabilityGain = potential * 0.15;
      target.stability = clamp(target.stability + stabilityGain);
      const constraintReduction = 0.05;
      constraintDelta = -constraintReduction;
      target.constraint_level = clamp(target.constraint_level - constraintReduction);
      sys.recovery_capacity = clamp(sys.recovery_capacity + 0.02);
    } else if (potential > 0 && roll < failureProb) {
      // Statistical failure despite positive potential
      outcome = 'propagation_failure';
      constraintDelta = 0.05;
      target.constraint_level = clamp(target.constraint_level + 0.05);
      sys.recovery_capacity = clamp(sys.recovery_capacity - 0.03);
    } else {
      // potential <= 0 — classify failure mode
      outcome = classifyFailure(potential, target, sys);

      if (outcome === 'propagation_failure') {
        constraintDelta = 0.05;
        target.constraint_level = clamp(target.constraint_level + 0.05);
        sys.recovery_capacity = clamp(sys.recovery_capacity - 0.03);
      } else if (outcome === 'correction_failure') {
        constraintDelta = 0.08;
        target.constraint_level = clamp(target.constraint_level + 0.08);
        target.stability = clamp(target.stability - 0.05);
        sys.pressure = clamp(sys.pressure + 0.03);
      } else {
        // distortion_failure
        constraintDelta = 0.10;
        target.constraint_level = clamp(target.constraint_level + 0.10);
        target.stability = clamp(target.stability - 0.03);
        // Spill to adjacent nodes (targets of the target)
        const downstream = graph.edges.filter((e2: CausalEdge) => e2.source === targetId);
        for (const de of downstream) {
          if (nodeStates[de.target]) {
            snapshotBefore(de.target);
            nodeStates[de.target].constraint_level = clamp(
              nodeStates[de.target].constraint_level + 0.02
            );
          }
        }
      }
    }

    // Lock check
    if (target.constraint_level >= thresholds.lock) {
      target.locked = true;
    }

    nodeStates[targetId] = target;

    edgeResults.push({
      edge_id: edge.id,
      outcome,
      propagation_potential: potential,
      constraint_delta: constraintDelta,
    });
  }

  // --- recompute system pressure ---
  sys.pressure = recomputePressure(nodeStates);
  sys.constraint = sys.pressure;

  // --- cascade spread ---
  if (sys.pressure >= thresholds.cascade) {
    for (const id of Object.keys(nodeStates)) {
      if (!nodeStates[id].locked) {
        snapshotBefore(id);
        nodeStates[id].constraint_level = clamp(nodeStates[id].constraint_level + 0.03);
        if (nodeStates[id].constraint_level >= thresholds.lock) {
          nodeStates[id].locked = true;
        }
      }
    }
    sys.recovery_capacity = clamp(sys.recovery_capacity - 0.05);
    // Recompute pressure after cascade spread
    sys.pressure = recomputePressure(nodeStates);
    sys.constraint = sys.pressure;
  }

  // --- update status ---
  sys.status = computeStatus(sys.pressure, thresholds);

  // --- finalise node deltas ---
  const nodeDeltaArr: NodeDelta[] = [];
  for (const [id, delta] of nodeDeltaMap.entries()) {
    const after = nodeStates[id];
    nodeDeltaArr.push({
      ...delta,
      stability_after: after.stability,
      constraint_after: after.constraint_level,
      locked_after: after.locked,
    });
  }

  // --- overall step outcome ---
  const outcomePriority: SimulationStep['step_outcome'][] = [
    'success',
    'propagation_failure',
    'correction_failure',
    'distortion_failure',
    'cascade',
    'collapse',
  ];
  let stepOutcome: SimulationStep['step_outcome'] = 'success';

  if (sys.status === 'collapsed') {
    stepOutcome = 'collapse';
  } else if (sys.status === 'cascade') {
    stepOutcome = 'cascade';
  } else if (edgeResults.length === 0) {
    stepOutcome = 'propagation_failure';
  } else {
    // Worst edge outcome wins
    let worstIdx = 0;
    for (const er of edgeResults) {
      const idx = outcomePriority.indexOf(er.outcome);
      if (idx > worstIdx) worstIdx = idx;
    }
    stepOutcome = outcomePriority[worstIdx];
  }

  // --- build step record ---
  const stepRecord: SimulationStep = {
    step: simState.step + 1,
    action: {
      source_node_id: action.source_node_id,
      actor_leverage: actorLeverage,
    },
    system_state_before: systemBefore,
    system_state_after: { ...sys },
    edge_results: edgeResults,
    node_deltas: nodeDeltaArr,
    step_outcome: stepOutcome,
    timestamp: now,
  };

  return {
    ...simState,
    step: simState.step + 1,
    system: sys,
    node_states: nodeStates,
    trace: [...simState.trace, stepRecord],
    status: sys.status,
    updatedAt: now,
  };
}
