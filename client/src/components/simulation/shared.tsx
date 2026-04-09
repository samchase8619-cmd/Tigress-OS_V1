/**
 * Shared simulation sub-components used by ManualPlay and Debrief.
 */

import { useState } from 'react';
import { ChevronRight, Lock, Eye, EyeOff, History } from 'lucide-react';
import type {
  CausalGraph,
  TurnLogEntry,
  NodeDelta,
  EdgeResult,
  TriggeredFailure,
  IrreversibleEvent,
  StepOutcome,
} from '../../types';

// ---------------------------------------------------------------------------
// Colour/icon helpers
// ---------------------------------------------------------------------------

export const outcomeColor: Record<StepOutcome, string> = {
  success: '#22c55e',
  propagation_failure: '#6b7280',
  correction_failure: '#dc2626',
  distortion_failure: '#f97316',
  cascade: '#f97316',
  collapse: '#dc2626',
};

export const failureIcon: Record<TriggeredFailure['type'], string> = {
  propagation_failure: '⛔',
  correction_failure: '🔄',
  distortion_failure: '🌀',
  cascade: '⚡',
  collapse: '💀',
};

export function clamp(v: number) { return Math.max(0, Math.min(1, v)); }

// ---------------------------------------------------------------------------
// StatBar
// ---------------------------------------------------------------------------

export function StatBar({
  label, value, before, color,
}: { label: string; value: number; before?: number; color: string }) {
  const pct = clamp(value) * 100;
  const diff = before !== undefined ? value - before : null;
  return (
    <div className="mp-stat-row">
      <span className="mp-stat-label">{label}</span>
      <div className="mp-stat-bar-bg">
        {before !== undefined && (
          <div className="mp-stat-bar-before" style={{ width: `${clamp(before) * 100}%` }} />
        )}
        <div className="mp-stat-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="mp-stat-value">{pct.toFixed(0)}%</span>
      {diff !== null && Math.abs(diff) >= 0.001 && (
        <span className="mp-stat-delta" style={{ color: diff > 0 ? '#dc2626' : '#22c55e' }}>
          {diff > 0 ? '+' : ''}{(diff * 100).toFixed(1)}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PropagationPath
// ---------------------------------------------------------------------------

export function PropagationPath({
  edgeResults,
  graph,
  entry,
}: {
  edgeResults: EdgeResult[];
  graph: CausalGraph;
  entry: TurnLogEntry;
}) {
  if (edgeResults.length === 0) {
    return (
      <div className="mp-prop-empty">
        No edges were traversed (source node blocked or no outgoing edges).
      </div>
    );
  }

  return (
    <div className="mp-prop-path">
      {edgeResults.map(er => {
        const edge = graph.edges.find(e => e.id === er.edge_id);
        const sourceNode = graph.nodes.find(n => n.id === entry.selected_action.source_node_id);
        const targetNode = graph.nodes.find(n => n.id === edge?.target);
        const afterState = entry.actual_state.node_states[edge?.target ?? ''];

        return (
          <div key={er.edge_id} className="mp-prop-row">
            <div className="mp-prop-node mp-prop-node--source">
              <span className="mp-prop-node-label">{sourceNode?.label ?? er.edge_id}</span>
              <span className="mp-prop-node-type">source</span>
            </div>

            <div className="mp-prop-edge">
              <div className="mp-prop-edge-line" style={{ background: outcomeColor[er.outcome] }} />
              <ChevronRight size={14} style={{ color: outcomeColor[er.outcome] }} className="mp-prop-edge-arrow" />
              <div className="mp-prop-edge-label">
                <span style={{ color: outcomeColor[er.outcome] }}>
                  {er.outcome.replace(/_/g, ' ')}
                </span>
                <span className="mp-prop-edge-detail">P={er.propagation_potential.toFixed(3)}</span>
              </div>
            </div>

            <div className="mp-prop-node mp-prop-node--target">
              <span className="mp-prop-node-label">{targetNode?.label ?? 'unknown'}</span>
              {er.constraint_delta !== 0 && (
                <span className="mp-prop-node-delta" style={{ color: er.constraint_delta > 0 ? '#dc2626' : '#22c55e' }}>
                  constraint {er.constraint_delta > 0 ? '+' : ''}{er.constraint_delta.toFixed(3)}
                </span>
              )}
              {afterState && (
                <span className="mp-prop-node-type">
                  constraint: {afterState.constraint_level.toFixed(3)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FailureDetail
// ---------------------------------------------------------------------------

export function FailureDetail({ failures }: { failures: TriggeredFailure[] }) {
  if (failures.length === 0) return null;
  const phaseColor: Record<string, string> = {
    perception: '#8b5cf6',
    targeting:  '#0ea5e9',
    effect:     '#f97316',
  };
  return (
    <div className="mp-failures">
      {failures.map((f, i) => (
        <div key={i} className="mp-failure-item">
          <span className="mp-failure-icon">{failureIcon[f.type]}</span>
          <div className="mp-failure-body">
            <span className="mp-failure-type">
              {f.type.replace(/_/g, ' ')}
              {f.distortion_phase && (
                <span
                  className="mp-distortion-phase-badge"
                  style={{ background: phaseColor[f.distortion_phase] ?? '#6b7280' }}
                >
                  {f.distortion_phase}
                </span>
              )}
            </span>
            {f.edge_id && <span className="mp-failure-edge">edge: {f.edge_id}</span>}
            <span className="mp-failure-reason">{f.reason}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeDeltaTable
// ---------------------------------------------------------------------------

export function NodeDeltaTable({
  deltas,
  graph,
}: {
  deltas: NodeDelta[];
  graph: CausalGraph;
}) {
  if (deltas.length === 0) {
    return <p className="text-secondary" style={{ fontSize: 12 }}>No node state changes this turn.</p>;
  }
  const nodeLabel = (id: string) => graph.nodes.find(n => n.id === id)?.label ?? id;

  return (
    <div className="mp-delta-table">
      {deltas.map(d => (
        <div key={d.node_id} className="mp-delta-row">
          <div className="mp-delta-node-name">{nodeLabel(d.node_id)}</div>
          <div className="mp-delta-stats">
            <StatBar label="Stability"   before={d.stability_before}   value={d.stability_after}   color="#22c55e" />
            <StatBar label="Constraint"  before={d.constraint_before}  value={d.constraint_after}  color="#dc2626" />
            {d.locked_after && !d.locked_before && (
              <div className="mp-delta-locked"><Lock size={11} /> Node became LOCKED this turn</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PerceivedActualToggle
// ---------------------------------------------------------------------------

export function PerceivedActualToggle({
  entry,
  graph,
}: {
  entry: TurnLogEntry;
  graph: CausalGraph;
}) {
  const [showActual, setShowActual] = useState(false);
  const nodeLabel = (id: string) => graph.nodes.find(n => n.id === id)?.label ?? id;

  return (
    <div className="mp-pa-panel">
      <div className="mp-pa-header">
        <div className="mp-pa-title">
          {showActual
            ? <><EyeOff size={13} /> Actual State (hidden from actor)</>
            : <><Eye size={13} /> Perceived State (AEIC-filtered)</>
          }
        </div>
        <button className="mp-pa-toggle" onClick={() => setShowActual(s => !s)}>
          {showActual ? 'Show perceived' : 'Reveal actual'}
        </button>
      </div>
      {!showActual ? (
        <div className="mp-pa-body">
          <div className="mp-pa-sys">
            <span>Pressure ≈ {entry.perceived_state.system.pressure.toFixed(2)}</span>
            <span className="mp-hidden-tag">recovery hidden</span>
            <span>Status: {entry.perceived_state.system.status}</span>
          </div>
          {Object.entries(entry.perceived_state.node_states).map(([id, ns]) => (
            <div key={id} className="mp-pa-node">
              <span className="mp-pa-node-name">{nodeLabel(id)}</span>
              <span>constraint ≈ {ns.constraint_level.toFixed(2)}</span>
              <span>stability ≈ {ns.stability.toFixed(1)}</span>
              {ns.locked && <Lock size={11} style={{ color: '#dc2626' }} />}
            </div>
          ))}
        </div>
      ) : (
        <div className="mp-pa-body mp-pa-body--actual">
          <div className="mp-pa-sys">
            <span>Pressure = {entry.actual_state.system.pressure.toFixed(4)}</span>
            <span>Recovery = {entry.actual_state.system.recovery_capacity.toFixed(4)}</span>
            <span>Status: {entry.actual_state.system.status}</span>
          </div>
          {Object.entries(entry.actual_state.node_states).map(([id, ns]) => (
            <div key={id} className="mp-pa-node">
              <span className="mp-pa-node-name">{nodeLabel(id)}</span>
              <span>constraint = {ns.constraint_level.toFixed(4)}</span>
              <span>stability = {ns.stability.toFixed(4)}</span>
              {ns.locked && <Lock size={11} style={{ color: '#dc2626' }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DistortionDetail
// ---------------------------------------------------------------------------

export function DistortionDetail({ entry, graph }: { entry: TurnLogEntry; graph: CausalGraph }) {
  const phases = entry.distortion_phases ?? [];
  if (phases.length === 0 && !entry.perceived_target) return null;

  const nodeLabel = (id: string | undefined) =>
    id ? (graph.nodes.find(n => n.id === id)?.label ?? id) : '—';

  const phaseColor: Record<string, string> = {
    perception: '#8b5cf6',
    targeting:  '#0ea5e9',
    effect:     '#f97316',
  };
  const phaseDesc: Record<string, string> = {
    perception: 'AEIC rounding flipped the success/failure prediction for the primary edge',
    targeting:  'Perceived best-target ≠ actual best-target due to AEIC constraint rounding',
    effect:     'Action energy absorbed without causal propagation; downstream spill occurred',
  };

  return (
    <div className="mp-distortion-detail">
      {(entry.perceived_target || entry.actual_target) && (
        <div className="mp-targeting-row">
          <div className="mp-targeting-col">
            <span className="mp-targeting-label">Perceived target</span>
            <span className="mp-targeting-node">{nodeLabel(entry.perceived_target)}</span>
            {entry.perceived_target && entry.actual_target && entry.perceived_target !== entry.actual_target && (
              <span className="mp-targeting-mismatch">≠ actual</span>
            )}
          </div>
          <div className="mp-targeting-col">
            <span className="mp-targeting-label">Actual best target</span>
            <span className="mp-targeting-node">{nodeLabel(entry.actual_target)}</span>
          </div>
        </div>
      )}
      {phases.length > 0 && (
        <div className="mp-phases-list">
          {phases.map(phase => (
            <div key={phase} className="mp-phase-row">
              <span className="mp-phase-badge" style={{ background: phaseColor[phase] }}>
                {phase.toUpperCase()}
              </span>
              <span className="mp-phase-desc">{phaseDesc[phase]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IrreversibleEventsLog
// ---------------------------------------------------------------------------

export function IrreversibleEventsLog({
  events,
  graph,
}: {
  events: IrreversibleEvent[];
  graph: CausalGraph;
}) {
  if (events.length === 0) return null;

  const nodeLabel = (id: string | undefined) =>
    id ? (graph.nodes.find(n => n.id === id)?.label ?? id) : undefined;

  const eventIcon: Record<IrreversibleEvent['type'], string> = {
    node_locked:       '🔒',
    cascade_triggered: '⚡',
    system_collapsed:  '💀',
  };

  return (
    <div className="mp-irrev-log">
      <div className="mp-irrev-title"><History size={13} /> Permanent State Changes</div>
      {events.map((ev, i) => (
        <div key={i} className="mp-irrev-item">
          <span className="mp-irrev-icon">{eventIcon[ev.type]}</span>
          <span className="mp-irrev-turn">T{ev.turn}</span>
          <span className="mp-irrev-desc">
            {ev.type.replace(/_/g, ' ')}
            {ev.node_id && ` — ${nodeLabel(ev.node_id) ?? ev.node_id}`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DistortionIntensityGauge
// ---------------------------------------------------------------------------

export function DistortionIntensityGauge({ intensity }: { intensity: number }) {
  const color =
    intensity < 0.3 ? '#22c55e' :
    intensity < 0.6 ? '#f59e0b' :
    '#dc2626';

  const label =
    intensity < 0.3 ? 'LOW' :
    intensity < 0.6 ? 'MED' :
    'HIGH';

  const description =
    intensity < 0.3
      ? 'AEIC perception is mostly accurate'
      : intensity < 0.6
      ? 'AEIC granularity degraded — partial distortion possible'
      : 'AEIC severely degraded — sign inversion / wrong-target probable';

  return (
    <div className="mp-distortion-gauge">
      <div className="mp-distortion-gauge-header">
        <span className="mp-distortion-gauge-label">AEIC Distortion Intensity</span>
        <span className="mp-distortion-gauge-badge" style={{ background: color }}>
          {label} {(intensity * 100).toFixed(0)}%
        </span>
      </div>
      <div className="mp-distortion-gauge-track">
        <div
          className="mp-distortion-gauge-fill"
          style={{ width: `${intensity * 100}%`, background: color }}
        />
      </div>
      <div className="mp-distortion-gauge-desc">{description}</div>
    </div>
  );
}
