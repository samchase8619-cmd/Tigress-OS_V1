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
  PerceivedNodeState,
  PerceivedSystemState,
  TriggeredFailure,
  IrreversibleEvent,
  TurnLogEntry,
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

function round(v: number, granularity: number): number {
  return Math.round(v / granularity) * granularity;
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
// AEIC — Actor Environmental Information Channel
// Produces the actor's PERCEIVED view of system state.
//
// Base rules (low distortion intensity):
//  - node stability: rounded to 0.1 granularity
//  - node constraint_level: rounded to 0.05 granularity
//  - system pressure: rounded to 0.05 granularity
//  - system recovery_capacity: NOT visible
//  - system status: exact
//
// At higher distortion_intensity the AEIC granularity degrades, making
// perception and targeting distortions increasingly likely without any
// random element — purely a function of system state.
// ---------------------------------------------------------------------------

// --- AEIC granularity schedules ---

function constraintGranularity(intensity: number): number {
  if (intensity < 0.3) return 0.05;   // low   — standard
  if (intensity < 0.6) return 0.10;   // medium — coarser
  return 0.15;                         // high   — very coarse
}

function stabilityGranularity(intensity: number): number {
  if (intensity < 0.3) return 0.1;
  if (intensity < 0.6) return 0.2;
  return 0.3;
}

function pressureGranularity(intensity: number): number {
  if (intensity < 0.3) return 0.05;
  if (intensity < 0.6) return 0.10;
  return 0.15;
}

/**
 * Compute distortion intensity — a deterministic 0–1 score derived entirely
 * from system state.  No RNG is involved.
 *
 *  base = pressureNorm×0.3 + thresholdProximity×0.5 + constraintNorm×0.2
 *    where thresholdProximity ramps 0→1 from cascade×0.8 to collapse.
 *  spike = +0.30 if cascade fired on the previous turn.
 *
 * Resulting ranges (approximate, cascade=0.6 / collapse=0.9 defaults):
 *   pressure ≈ 0.10  → intensity ≈ 0.05  (mostly accurate AEIC)
 *   pressure ≈ 0.40  → intensity ≈ 0.22  (modest degradation)
 *   pressure ≈ 0.60  → intensity ≈ 0.48  (medium: constraint granulaity 0.10)
 *   pressure ≈ 0.75  → intensity ≈ 0.73  (high: granularity 0.15)
 *   + cascade spike   → clamp(above + 0.30)
 */
function computeDistortionIntensity(
  sys: SystemState,
  instabilitySpikeActive: boolean
): number {
  const { cascade, collapse } = sys.thresholds;

  // 1. Pressure normalised against collapse threshold
  const pressureNorm = clamp(sys.pressure / collapse);

  // 2. Threshold proximity: ramps 0→1 from cascade*0.8 to collapse
  const cascadeOnset = cascade * 0.8;
  const proximitySpan = collapse - cascadeOnset;
  const proximityFactor = proximitySpan > 0
    ? clamp((sys.pressure - cascadeOnset) / proximitySpan)
    : 0;

  // 3. Constraint factor (same normalisation as pressure)
  const constraintFactor = clamp(sys.constraint / collapse);

  // 4. Weighted base
  const base = pressureNorm * 0.3 + proximityFactor * 0.5 + constraintFactor * 0.2;

  // 5. Instability spike: +0.30 if cascade fired on the previous turn
  const spike = instabilitySpikeActive ? 0.30 : 0;

  return clamp(base + spike);
}

function buildPerceivedNodeState(state: NodeState, intensity: number): PerceivedNodeState {
  return {
    stability: round(clamp(state.stability), stabilityGranularity(intensity)),
    constraint_level: round(clamp(state.constraint_level), constraintGranularity(intensity)),
    locked: state.locked,
  };
}

function buildPerceivedSystemState(sys: SystemState, intensity: number): PerceivedSystemState {
  return {
    pressure: round(clamp(sys.pressure), pressureGranularity(intensity)),
    recovery_capacity_visible: false,
    status: sys.status,
  };
}

function buildPerceivedState(
  nodeStates: Record<string, NodeState>,
  sys: SystemState,
  intensity: number
): TurnLogEntry['perceived_state'] {
  const perceived: Record<string, PerceivedNodeState> = {};
  for (const id of Object.keys(nodeStates)) {
    perceived[id] = buildPerceivedNodeState(nodeStates[id], intensity);
  }
  return {
    node_states: perceived,
    system: buildPerceivedSystemState(sys, intensity),
  };
}

// ---------------------------------------------------------------------------
// Distortion detection — per-turn, deterministic, AEIC-driven
// ---------------------------------------------------------------------------

type DistortionPhase = 'perception' | 'targeting' | 'effect';

/**
 * PERCEPTION distortion: the AEIC-filtered view of the primary outgoing
 * edge's target flips the success/failure prediction.
 *
 * Fires when:
 *   P_perceived > 0  BUT  P_actual <= 0   (actor thinks success, engine fails)
 *   OR
 *   P_perceived <= 0 BUT  P_actual > 0    (actor thinks fail, engine succeeds)
 *
 * At higher distortion intensity, coarser granularity makes this more likely
 * because rounding bins are wider — values near zero are more often pushed
 * across the sign boundary.
 */
function detectPerceptionDistortion(
  primaryEdge: CausalEdge | undefined,
  nodeStates: Record<string, NodeState>,
  actorLeverage: number,
  systemBefore: SystemState,
  intensity: number
): boolean {
  if (!primaryEdge) return false;
  const target = nodeStates[primaryEdge.target];
  if (!target || target.locked) return false;

  const perceivedConstraint = buildPerceivedNodeState(target, intensity).constraint_level;
  const perceivedPressure = buildPerceivedSystemState(systemBefore, intensity).pressure;

  const pPerceived =
    (actorLeverage - perceivedConstraint - primaryEdge.propagation_cost - perceivedPressure) *
    primaryEdge.openness;
  const pActual =
    (actorLeverage - target.constraint_level - primaryEdge.propagation_cost - systemBefore.pressure) *
    primaryEdge.openness;

  return (pPerceived > 0 && pActual <= 0) || (pPerceived <= 0 && pActual > 0);
}

/**
 * TARGETING distortion: the node the actor would naturally choose as primary
 * target (lowest perceived constraint among reachable targets) differs from
 * the actual best target (lowest actual constraint).
 *
 * At higher distortion intensity, wider rounding bins cause two targets with
 * different actual constraints to appear identical in the AEIC view,
 * increasing the chance of a tie-break mismatch.
 */
function detectTargetingDistortion(
  outgoing: CausalEdge[],
  nodeStates: Record<string, NodeState>,
  intensity: number
): {
  fires: boolean;
  perceived_target: string | undefined;
  actual_target: string | undefined;
} {
  if (outgoing.length === 0) {
    return { fires: false, perceived_target: undefined, actual_target: undefined };
  }
  if (outgoing.length === 1) {
    return { fires: false, perceived_target: outgoing[0].target, actual_target: outgoing[0].target };
  }

  let perceivedBest: string | undefined;
  let perceivedMin = Infinity;
  let actualBest: string | undefined;
  let actualMin = Infinity;

  for (const edge of outgoing) {
    const target = nodeStates[edge.target];
    if (!target || target.locked) continue;

    const perceived = buildPerceivedNodeState(target, intensity).constraint_level;
    if (perceived < perceivedMin) {
      perceivedMin = perceived;
      perceivedBest = edge.target;
    }
    if (target.constraint_level < actualMin) {
      actualMin = target.constraint_level;
      actualBest = edge.target;
    }
  }

  return {
    fires: perceivedBest !== undefined && actualBest !== undefined && perceivedBest !== actualBest,
    perceived_target: perceivedBest,
    actual_target: actualBest,
  };
}

// ---------------------------------------------------------------------------
// Reason strings — human-readable propagation result explanations
// ---------------------------------------------------------------------------

function reasonForEdgeOutcome(
  outcome: EdgeResult['outcome'],
  potential: number,
  failureProb: number,
  roll: number,
  targetConstraint: number,
  lockThreshold: number,
  pressure: number,
  cascadeThreshold: number,
  wasLocked: boolean
): string {
  if (wasLocked) {
    return `Target node is locked (constraint_level=${targetConstraint.toFixed(3)} >= lock threshold ${lockThreshold.toFixed(2)})`;
  }
  switch (outcome) {
    case 'success':
      return `P=${potential.toFixed(3)} succeeded (roll=${roll.toFixed(3)} >= failure_prob=${failureProb.toFixed(3)})`;
    case 'propagation_failure':
      if (potential > 0) {
        return `Statistical block: P=${potential.toFixed(3)} > 0 but roll=${roll.toFixed(3)} < failure_prob=${failureProb.toFixed(3)} — system pressure overwhelmed recovery`;
      }
      return `Insufficient potential P=${potential.toFixed(3)}: target constraint_level=${targetConstraint.toFixed(3)} is near lock threshold (${(lockThreshold * 0.85).toFixed(3)})`;
    case 'correction_failure':
      return `Correction inverted by system pressure: pressure=${pressure.toFixed(3)} >= cascade*0.8=${(cascadeThreshold * 0.8).toFixed(3)}; intended change absorbed by systemic stress`;
    case 'distortion_failure':
      return `Distortion: P=${potential.toFixed(3)} reached target but was absorbed without causal effect; downstream constraint spill applied`;
    default:
      return `Unknown outcome for edge`;
  }
}

function reasonForStepOutcome(
  outcome: SimulationStep['step_outcome'],
  sys: SystemState
): string {
  switch (outcome) {
    case 'success':
      return 'All outgoing edges propagated successfully';
    case 'propagation_failure':
      return 'Propagation was structurally or statistically blocked on at least one edge';
    case 'correction_failure':
      return `System pressure (${sys.pressure.toFixed(3)}) is too high — corrections are being inverted`;
    case 'distortion_failure':
      return `Action energy was dispersed without causal effect; downstream spill occurred`;
    case 'cascade':
      return `SYSTEM CASCADE: pressure ${sys.pressure.toFixed(3)} >= cascade threshold ${sys.thresholds.cascade.toFixed(2)} — all non-locked nodes absorbing additional constraint`;
    case 'collapse':
      return `SYSTEM COLLAPSED: pressure ${sys.pressure.toFixed(3)} >= collapse threshold ${sys.thresholds.collapse.toFixed(2)} — no further propagation possible`;
    default:
      return `Unknown step outcome`;
  }
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

  // --- compute distortion intensity from current system state (before any action) ---
  const distortionIntensity = computeDistortionIntensity(
    simState.system,
    simState.instability_spike_active ?? false
  );

  // --- guard: collapsed systems cannot propagate ---
  if (simState.status === 'collapsed') {
    const actorLeverageCollapsed = action.actor_leverage ??
      (graph.nodes.find((n: CausalNode) => n.id === action.source_node_id)?.actor_leverage ?? 0);

    const turnEntry: TurnLogEntry = {
      step: simState.step + 1,
      timestamp: now,
      perceived_state: buildPerceivedState(simState.node_states, simState.system, distortionIntensity),
      actual_state: {
        node_states: simState.node_states,
        system: simState.system,
      },
      selected_action: {
        source_node_id: action.source_node_id,
        actor_leverage: actorLeverageCollapsed,
      },
      propagation_result: {
        outcome: 'collapse',
        reason: `SYSTEM COLLAPSED: pressure ${simState.system.pressure.toFixed(3)} >= collapse threshold ${thresholds.collapse.toFixed(2)} — no further propagation possible`,
        edge_results: [],
      },
      recovery_capacity_change: 0,
      pressure_change: 0,
      constraint_change: 0,
      triggered_failures: [{
        type: 'collapse',
        reason: `System pressure ${simState.system.pressure.toFixed(3)} >= collapse threshold ${thresholds.collapse.toFixed(2)}`,
      }],
      distortion_phases: [],
      distortion_intensity: distortionIntensity,
    };

    const collapseStep: SimulationStep = {
      step: simState.step + 1,
      action: { source_node_id: action.source_node_id, actor_leverage: actorLeverageCollapsed },
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
      turn_log: [...(simState.turn_log ?? []), turnEntry],
      irreversible_events: [...(simState.irreversible_events ?? [])],
      instability_spike_active: false,
      updatedAt: now,
    };
  }

  // --- snapshot system state before ---
  const systemBefore: SystemState = { ...simState.system, thresholds: { ...thresholds } };

  // --- snapshot node states before (for actual_state in turn log) ---
  const nodeStatesBefore: Record<string, NodeState> = {};
  for (const id of Object.keys(simState.node_states)) {
    nodeStatesBefore[id] = { ...simState.node_states[id] };
  }

  // --- build perceived state BEFORE the action executes ---
  const perceivedState = buildPerceivedState(nodeStatesBefore, systemBefore, distortionIntensity);

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

  // Triggered failures collector
  const triggeredFailures: TriggeredFailure[] = [];

  // --- guard: source node must exist and not be locked ---
  if (!sourceNode || (nodeStates[action.source_node_id]?.locked ?? false)) {
    const blockReason = !sourceNode
      ? `Source node '${action.source_node_id}' does not exist in the graph`
      : `Source node '${action.source_node_id}' is locked (constraint_level=${nodeStates[action.source_node_id].constraint_level.toFixed(3)})`;

    triggeredFailures.push({
      type: 'propagation_failure',
      target_node_id: action.source_node_id,
      reason: blockReason,
    });

    const turnEntry: TurnLogEntry = {
      step: simState.step + 1,
      timestamp: now,
      perceived_state: perceivedState,
      actual_state: { node_states: nodeStatesBefore, system: systemBefore },
      selected_action: { source_node_id: action.source_node_id, actor_leverage: actorLeverage },
      propagation_result: {
        outcome: 'propagation_failure',
        reason: blockReason,
        edge_results: [],
      },
      recovery_capacity_change: 0,
      pressure_change: 0,
      constraint_change: 0,
      triggered_failures: triggeredFailures,
      distortion_phases: [],
      distortion_intensity: distortionIntensity,
    };

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
      turn_log: [...(simState.turn_log ?? []), turnEntry],
      irreversible_events: [...(simState.irreversible_events ?? [])],
      instability_spike_active: false,
      updatedAt: now,
    };
  }

  // --- process each outgoing edge ---
  const outgoing: CausalEdge[] = graph.edges.filter(
    (e: CausalEdge) => e.source === action.source_node_id
  );

  // --- detect distortion phases BEFORE processing edges (uses before-state) ---
  const primaryEdge: CausalEdge | undefined = outgoing.find(
    (e) => !!(nodeStates[e.target]) && !nodeStates[e.target].locked
  );
  const perceptionFires = detectPerceptionDistortion(
    primaryEdge,
    nodeStates,
    actorLeverage,
    systemBefore,
    distortionIntensity
  );
  const { fires: targetingFires, perceived_target, actual_target } =
    detectTargetingDistortion(outgoing, nodeStates, distortionIntensity);

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
      const lockedReason = `Target node '${targetId}' is locked (constraint_level=${target.constraint_level.toFixed(3)} >= lock threshold ${thresholds.lock.toFixed(2)})`;
      triggeredFailures.push({
        type: 'propagation_failure',
        edge_id: edge.id,
        target_node_id: targetId,
        reason: lockedReason,
      });
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

    // Record failure events
    if (outcome !== 'success') {
      triggeredFailures.push({
        type: outcome,
        edge_id: edge.id,
        target_node_id: targetId,
        distortion_phase: outcome === 'distortion_failure' ? 'effect' : undefined,
        reason: reasonForEdgeOutcome(
          outcome,
          potential,
          failureProb,
          roll,
          target.constraint_level,
          thresholds.lock,
          sys.pressure,
          thresholds.cascade,
          false
        ),
      });
    }

    // Lock check — also records as irreversible event
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
  const newIrreversibleEvents: IrreversibleEvent[] = [];
  let cascadeFiredThisTurn = false;

  if (sys.pressure >= thresholds.cascade) {
    cascadeFiredThisTurn = true;
    triggeredFailures.push({
      type: 'cascade',
      reason: `System pressure ${sys.pressure.toFixed(3)} >= cascade threshold ${thresholds.cascade.toFixed(2)} — all non-locked nodes absorbing +0.03 constraint`,
    });
    newIrreversibleEvents.push({
      type: 'cascade_triggered',
      turn: simState.step + 1,
      reason: `System pressure ${sys.pressure.toFixed(3)} reached cascade threshold ${thresholds.cascade.toFixed(2)}`,
    });

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

  // --- accumulate node-lock irreversible events ---
  for (const id of Object.keys(nodeStates)) {
    const wasLocked = nodeStatesBefore[id]?.locked ?? false;
    if (!wasLocked && nodeStates[id].locked) {
      newIrreversibleEvents.push({
        type: 'node_locked',
        node_id: id,
        turn: simState.step + 1,
        reason: `Node '${id}' constraint_level reached lock threshold ${thresholds.lock.toFixed(2)}`,
      });
    }
  }

  // --- update status ---
  sys.status = computeStatus(sys.pressure, thresholds);

  if (sys.status === 'collapsed') {
    triggeredFailures.push({
      type: 'collapse',
      reason: `System pressure ${sys.pressure.toFixed(3)} reached collapse threshold ${thresholds.collapse.toFixed(2)} — simulation has collapsed`,
    });
    newIrreversibleEvents.push({
      type: 'system_collapsed',
      turn: simState.step + 1,
      reason: `System pressure ${sys.pressure.toFixed(3)} reached collapse threshold ${thresholds.collapse.toFixed(2)}`,
    });
  }

  // --- add perception and targeting distortion triggered-failure records ---
  if (perceptionFires) {
    triggeredFailures.push({
      type: 'distortion_failure',
      distortion_phase: 'perception',
      target_node_id: primaryEdge?.target,
      reason:
        `AEIC perception flip: actor's perceived propagation potential for edge to '${primaryEdge?.target}' ` +
        `has the opposite sign to the actual potential — ` +
        `actor's success prediction is inverted by AEIC rounding`,
    });
  }
  if (targetingFires) {
    triggeredFailures.push({
      type: 'distortion_failure',
      distortion_phase: 'targeting',
      target_node_id: actual_target,
      reason:
        `AEIC targeting mismatch: actor perceives '${perceived_target}' as best target ` +
        `(lowest perceived constraint) but actual best target is '${actual_target}' ` +
        `(lower actual constraint that AEIC rounds to same or higher perceived value)`,
    });
  }

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
    // Perception or targeting distortion elevates outcome to distortion_failure
    if (perceptionFires || targetingFires) {
      const distortionIdx = outcomePriority.indexOf('distortion_failure');
      if (distortionIdx > worstIdx) worstIdx = distortionIdx;
    }
    stepOutcome = outcomePriority[worstIdx];
  }

  // --- assemble distortion phases ---
  const distortionPhases: Array<'perception' | 'targeting' | 'effect'> = [];
  if (perceptionFires) distortionPhases.push('perception');
  if (targetingFires) distortionPhases.push('targeting');
  if (edgeResults.some((er) => er.outcome === 'distortion_failure')) {
    distortionPhases.push('effect');
  }

  // --- build step record (compact trace) ---
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

  // --- build turn log entry (full visibility record) ---
  const turnLogEntry: TurnLogEntry = {
    step: simState.step + 1,
    timestamp: now,
    perceived_state: perceivedState,
    actual_state: {
      node_states: nodeStatesBefore,
      system: systemBefore,
    },
    selected_action: {
      source_node_id: action.source_node_id,
      actor_leverage: actorLeverage,
    },
    propagation_result: {
      outcome: stepOutcome,
      reason: reasonForStepOutcome(stepOutcome, sys),
      edge_results: edgeResults,
    },
    recovery_capacity_change: sys.recovery_capacity - systemBefore.recovery_capacity,
    pressure_change: sys.pressure - systemBefore.pressure,
    constraint_change: sys.constraint - systemBefore.constraint,
    triggered_failures: triggeredFailures,
    perceived_target,
    actual_target,
    distortion_phases: distortionPhases,
    distortion_intensity: distortionIntensity,
  };

  return {
    ...simState,
    step: simState.step + 1,
    system: sys,
    node_states: nodeStates,
    trace: [...simState.trace, stepRecord],
    turn_log: [...(simState.turn_log ?? []), turnLogEntry],
    irreversible_events: [...(simState.irreversible_events ?? []), ...newIrreversibleEvents],
    status: sys.status,
    instability_spike_active: cascadeFiredThisTurn,
    updatedAt: now,
  };
}
