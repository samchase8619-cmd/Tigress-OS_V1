/**
 * ManualPlay — deterministic manual turn execution.
 *
 * The user controls:
 *   1. Graph selection
 *   2. Source node selection
 *   3. Actor leverage
 *   4. Action card (placeholder — selects the intervention type)
 *
 * After executing a turn, the page shows:
 *   - Propagation path (which edges fired, outcome per edge)
 *   - Failure detail (if any), with labeled cause
 *   - Node state deltas (before / after)
 *   - Side-by-side perceived vs actual system state
 *
 * No automation. No AI. Every step is user-initiated.
 */

import { useState, useEffect } from 'react';
import {
  Play,
  RotateCcw,
  ChevronRight,
  AlertTriangle,
  Zap,
  Lock,
  Eye,
  EyeOff,
  Swords,
  FlaskConical,
  Shield,
  Info,
} from 'lucide-react';
import type {
  CausalGraph,
  SimulationState,
  TurnLogEntry,
  NodeDelta,
  EdgeResult,
  TriggeredFailure,
  StepOutcome,
} from '../../types';
import * as api from '../../api/client';

// ---------------------------------------------------------------------------
// Action cards (placeholders)
// ---------------------------------------------------------------------------
interface ActionCard {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  leverageModifier: number; // additive modifier on top of slider value (capped 0–1)
}

const ACTION_CARDS: ActionCard[] = [
  {
    id: 'direct',
    label: 'Direct Intervention',
    description: 'Apply your full leverage directly to the selected node. No modifier.',
    icon: <Swords size={18} />,
    leverageModifier: 0,
  },
  {
    id: 'measured',
    label: 'Measured Response',
    description: 'Careful, calibrated action. Reduces leverage by 0.15 to minimise spill.',
    icon: <FlaskConical size={18} />,
    leverageModifier: -0.15,
  },
  {
    id: 'fortify',
    label: 'Fortify Position',
    description: 'Invest leverage into stability rather than propagation. +0.10 boost.',
    icon: <Shield size={18} />,
    leverageModifier: 0.1,
  },
];

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
const outcomeColor: Record<StepOutcome, string> = {
  success: '#22c55e',
  propagation_failure: '#6b7280',
  correction_failure: '#dc2626',
  distortion_failure: '#f97316',
  cascade: '#f97316',
  collapse: '#dc2626',
};

const failureIcon: Record<TriggeredFailure['type'], string> = {
  propagation_failure: '⛔',
  correction_failure: '🔄',
  distortion_failure: '🌀',
  cascade: '⚡',
  collapse: '💀',
};

function clamp(v: number) { return Math.max(0, Math.min(1, v)); }

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatBar({
  label, value, before, color,
}: { label: string; value: number; before?: number; color: string }) {
  const pct = clamp(value) * 100;
  const diff = before !== undefined ? value - before : null;
  return (
    <div className="mp-stat-row">
      <span className="mp-stat-label">{label}</span>
      <div className="mp-stat-bar-bg">
        {before !== undefined && (
          <div
            className="mp-stat-bar-before"
            style={{ width: `${clamp(before) * 100}%` }}
          />
        )}
        <div
          className="mp-stat-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="mp-stat-value">{(pct).toFixed(0)}%</span>
      {diff !== null && Math.abs(diff) >= 0.001 && (
        <span
          className="mp-stat-delta"
          style={{ color: diff > 0 ? '#dc2626' : '#22c55e' }}
        >
          {diff > 0 ? '+' : ''}{(diff * 100).toFixed(1)}
        </span>
      )}
    </div>
  );
}

function PropagationPath({
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
        const beforeState = entry.actual_state.node_states[edge?.target ?? ''];
        const afterState = entry.actual_state.node_states[edge?.target ?? ''];

        return (
          <div key={er.edge_id} className="mp-prop-row">
            {/* Source */}
            <div className="mp-prop-node mp-prop-node--source">
              <span className="mp-prop-node-label">{sourceNode?.label ?? er.edge_id}</span>
              <span className="mp-prop-node-type">source</span>
            </div>

            {/* Edge arrow */}
            <div className="mp-prop-edge">
              <div
                className="mp-prop-edge-line"
                style={{ background: outcomeColor[er.outcome] }}
              />
              <ChevronRight
                size={14}
                style={{ color: outcomeColor[er.outcome] }}
                className="mp-prop-edge-arrow"
              />
              <div className="mp-prop-edge-label">
                <span style={{ color: outcomeColor[er.outcome] }}>
                  {er.outcome.replace(/_/g, ' ')}
                </span>
                <span className="mp-prop-edge-detail">
                  P={er.propagation_potential.toFixed(3)}
                </span>
              </div>
            </div>

            {/* Target */}
            <div className="mp-prop-node mp-prop-node--target">
              <span className="mp-prop-node-label">{targetNode?.label ?? 'unknown'}</span>
              {er.constraint_delta !== 0 && (
                <span
                  className="mp-prop-node-delta"
                  style={{ color: er.constraint_delta > 0 ? '#dc2626' : '#22c55e' }}
                >
                  constraint {er.constraint_delta > 0 ? '+' : ''}{er.constraint_delta.toFixed(3)}
                </span>
              )}
              {beforeState && (
                <span className="mp-prop-node-type">
                  constraint: {(afterState?.constraint_level ?? 0).toFixed(3)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FailureDetail({ failures }: { failures: TriggeredFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <div className="mp-failures">
      {failures.map((f, i) => (
        <div key={i} className="mp-failure-item">
          <span className="mp-failure-icon">{failureIcon[f.type]}</span>
          <div className="mp-failure-body">
            <span className="mp-failure-type">{f.type.replace(/_/g, ' ')}</span>
            {f.edge_id && <span className="mp-failure-edge">edge: {f.edge_id}</span>}
            <span className="mp-failure-reason">{f.reason}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function NodeDeltaTable({
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
            <StatBar
              label="Stability"
              before={d.stability_before}
              value={d.stability_after}
              color="#22c55e"
            />
            <StatBar
              label="Constraint"
              before={d.constraint_before}
              value={d.constraint_after}
              color="#dc2626"
            />
            {d.locked_after && !d.locked_before && (
              <div className="mp-delta-locked">
                <Lock size={11} /> Node became LOCKED this turn
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PerceivedActualToggle({
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
          {showActual ? (
            <><EyeOff size={13} /> Actual State (hidden from actor)</>
          ) : (
            <><Eye size={13} /> Perceived State (AEIC-filtered)</>
          )}
        </div>
        <button
          className="mp-pa-toggle"
          onClick={() => setShowActual(s => !s)}
        >
          {showActual ? 'Show perceived' : 'Reveal actual'}
        </button>
      </div>

      {!showActual ? (
        // Perceived
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
        // Actual
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

function TurnResult({
  entry,
  graph,
  deltas,
}: {
  entry: TurnLogEntry;
  graph: CausalGraph;
  deltas: NodeDelta[];
}) {
  const outcome = entry.propagation_result.outcome;

  return (
    <div className="mp-result">
      {/* Outcome banner */}
      <div
        className="mp-result-banner"
        style={{ borderColor: outcomeColor[outcome], color: outcomeColor[outcome] }}
      >
        {outcome === 'collapse' || outcome === 'cascade' ? (
          <AlertTriangle size={16} />
        ) : outcome === 'success' ? (
          <Zap size={16} />
        ) : (
          <Info size={16} />
        )}
        <span className="mp-result-outcome">{outcome.replace(/_/g, ' ').toUpperCase()}</span>
        <span className="mp-result-step">Turn {entry.step}</span>
      </div>

      {/* Reason */}
      <div className="mp-result-reason">
        <strong>Why:</strong> {entry.propagation_result.reason}
      </div>

      {/* System deltas */}
      <div className="mp-result-section">
        <div className="mp-result-section-title">System Deltas</div>
        <div className="mp-sys-deltas">
          {[
            { label: 'Pressure', value: entry.pressure_change },
            { label: 'Constraint', value: entry.constraint_change },
            { label: 'Recovery', value: entry.recovery_capacity_change, invert: true },
          ].map(({ label, value, invert }) => {
            const isGood = invert ? value > 0 : value < 0;
            const isBad = invert ? value < 0 : value > 0;
            const color = Math.abs(value) < 0.001 ? '#6b7280' : isGood ? '#22c55e' : isBad ? '#dc2626' : '#6b7280';
            return (
              <div key={label} className="mp-sys-delta-item">
                <span className="mp-sys-delta-label">{label}</span>
                <span className="mp-sys-delta-value" style={{ color }}>
                  {value > 0 ? '+' : ''}{value.toFixed(4)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Propagation path */}
      <div className="mp-result-section">
        <div className="mp-result-section-title">Propagation Path</div>
        <PropagationPath
          edgeResults={entry.propagation_result.edge_results}
          graph={graph}
          entry={entry}
        />
      </div>

      {/* Triggered failures */}
      {entry.triggered_failures.length > 0 && (
        <div className="mp-result-section">
          <div className="mp-result-section-title">
            Triggered Failures ({entry.triggered_failures.length})
          </div>
          <FailureDetail failures={entry.triggered_failures} />
        </div>
      )}

      {/* Node state deltas */}
      <div className="mp-result-section">
        <div className="mp-result-section-title">Node State Deltas</div>
        <NodeDeltaTable deltas={deltas} graph={graph} />
      </div>

      {/* Perceived vs actual */}
      <div className="mp-result-section">
        <div className="mp-result-section-title">State Visibility (AEIC)</div>
        <PerceivedActualToggle entry={entry} graph={graph} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function ManualPlay() {
  const [graphs, setGraphs] = useState<CausalGraph[]>([]);
  const [selectedGraph, setSelectedGraph] = useState<CausalGraph | null>(null);
  const [simState, setSimState] = useState<SimulationState | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [actorLeverage, setActorLeverage] = useState<number>(0.5);
  const [selectedCard, setSelectedCard] = useState<ActionCard>(ACTION_CARDS[0]);
  const [lastEntry, setLastEntry] = useState<TurnLogEntry | null>(null);
  const [lastDeltas, setLastDeltas] = useState<NodeDelta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listGraphs().then(setGraphs).catch(e => setError(String(e)));
  }, []);

  const handleSelectGraph = (g: CausalGraph) => {
    setSelectedGraph(g);
    setSimState(null);
    setLastEntry(null);
    setLastDeltas([]);
    setSelectedSourceId(g.nodes[0]?.id ?? null);
    setActorLeverage(g.nodes[0]?.actor_leverage ?? 0.5);
  };

  const handleReset = () => {
    setSimState(null);
    setLastEntry(null);
    setLastDeltas([]);
  };

  const handleExecute = async () => {
    if (!selectedGraph || !selectedSourceId) return;
    setLoading(true);
    setError(null);
    try {
      const effectiveLeverage = clamp(actorLeverage + selectedCard.leverageModifier);
      const result = await api.runStep(
        selectedGraph.id,
        selectedSourceId,
        effectiveLeverage,
        simState?.id
      );
      setSimState(result);
      const entry = result.turn_log.at(-1) ?? null;
      setLastEntry(entry);
      // Extract node deltas from the last trace step
      const lastStep = result.trace.at(-1);
      setLastDeltas(lastStep?.node_deltas ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const isCollapsed = simState?.status === 'collapsed';

  // Effective leverage the action card will apply
  const effectiveLeverage = clamp(actorLeverage + selectedCard.leverageModifier);

  return (
    <div className="mp-layout">
      {/* ---- Left column: graph list ---- */}
      <aside className="mp-sidebar">
        <h2 className="mp-sidebar-title">Graphs</h2>
        <ul className="mp-graph-list">
          {graphs.map(g => (
            <li
              key={g.id}
              className={`mp-graph-item ${selectedGraph?.id === g.id ? 'mp-graph-item--active' : ''}`}
              onClick={() => handleSelectGraph(g)}
            >
              {g.name}
            </li>
          ))}
          {graphs.length === 0 && (
            <li className="mp-graph-empty">No graphs. Create one in Simulation Engine.</li>
          )}
        </ul>

        {/* System state summary */}
        {simState && (
          <div className="mp-sys-summary">
            <div className="mp-sys-summary-title">System State</div>
            <StatBar label="Pressure" value={simState.system.pressure} color="#dc2626" />
            <StatBar label="Recovery" value={simState.system.recovery_capacity} color="#7c3aed" />
            <StatBar label="Constraint" value={simState.system.constraint} color="#ea580c" />
            {simState.system.status !== 'active' && (
              <div className={`mp-status-badge mp-status-badge--${simState.system.status}`}>
                {simState.system.status === 'cascade'
                  ? <><Zap size={11} /> CASCADE</>
                  : <><AlertTriangle size={11} /> COLLAPSED</>
                }
              </div>
            )}
            <div className="mp-sys-step">Turn {simState.step}</div>
          </div>
        )}
      </aside>

      {/* ---- Middle column: action panel ---- */}
      <main className="mp-action-panel">
        {selectedGraph ? (
          <>
            <div className="mp-graph-title">
              <h2>{selectedGraph.name}</h2>
              {selectedGraph.description && (
                <p className="text-secondary">{selectedGraph.description}</p>
              )}
            </div>

            {/* ---- Source node selector ---- */}
            <section className="mp-section">
              <h3 className="mp-section-title">1. Select Source Node</h3>
              <div className="mp-node-grid">
                {selectedGraph.nodes.map(n => {
                  const ns = simState?.node_states[n.id];
                  const locked = ns?.locked ?? n.locked;
                  const constraint = ns?.constraint_level ?? n.constraint_level;
                  const isSelected = selectedSourceId === n.id;
                  return (
                    <button
                      key={n.id}
                      className={`mp-node-card ${isSelected ? 'mp-node-card--selected' : ''} ${locked ? 'mp-node-card--locked' : ''}`}
                      onClick={() => {
                        if (!locked) {
                          setSelectedSourceId(n.id);
                          setActorLeverage(n.actor_leverage);
                        }
                      }}
                      disabled={locked}
                    >
                      <div className="mp-node-card-label">
                        {locked && <Lock size={10} />} {n.label}
                      </div>
                      <div className="mp-node-card-type">{n.type}</div>
                      <div className="mp-node-card-stats">
                        <span style={{ color: '#dc2626' }}>
                          c={constraint.toFixed(2)}
                        </span>
                        <span style={{ color: '#7c3aed' }}>
                          lev={n.actor_leverage.toFixed(2)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ---- Leverage slider ---- */}
            <section className="mp-section">
              <h3 className="mp-section-title">2. Adjust Leverage</h3>
              <div className="mp-leverage">
                <div className="mp-leverage-row">
                  <span>Slider: <strong>{actorLeverage.toFixed(2)}</strong></span>
                  <span>Card modifier: <strong>
                    {selectedCard.leverageModifier >= 0 ? '+' : ''}{selectedCard.leverageModifier.toFixed(2)}
                  </strong></span>
                  <span className="mp-leverage-effective">
                    Effective: <strong>{effectiveLeverage.toFixed(2)}</strong>
                  </span>
                </div>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={actorLeverage}
                  onChange={e => setActorLeverage(Number(e.target.value))}
                  className="mp-slider"
                />
              </div>
            </section>

            {/* ---- Action card selector ---- */}
            <section className="mp-section">
              <h3 className="mp-section-title">3. Choose Action</h3>
              <div className="mp-card-grid">
                {ACTION_CARDS.map(card => (
                  <button
                    key={card.id}
                    className={`mp-action-card ${selectedCard.id === card.id ? 'mp-action-card--selected' : ''}`}
                    onClick={() => setSelectedCard(card)}
                  >
                    <div className="mp-action-card-icon">{card.icon}</div>
                    <div className="mp-action-card-label">{card.label}</div>
                    <div className="mp-action-card-desc">{card.description}</div>
                    <div className="mp-action-card-mod">
                      Leverage {selectedCard.id === card.id ? effectiveLeverage.toFixed(2) : clamp(actorLeverage + card.leverageModifier).toFixed(2)}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {/* ---- Execute ---- */}
            <section className="mp-section mp-section--execute">
              <div className="mp-execute-summary">
                {selectedSourceId && (
                  <span>
                    Acting from <strong>
                      {selectedGraph.nodes.find(n => n.id === selectedSourceId)?.label}
                    </strong> with leverage <strong>{effectiveLeverage.toFixed(2)}</strong> via <strong>{selectedCard.label}</strong>
                  </span>
                )}
              </div>
              <div className="mp-execute-buttons">
                <button
                  className="mp-btn-execute"
                  onClick={handleExecute}
                  disabled={loading || !selectedSourceId || isCollapsed}
                >
                  <Play size={16} />
                  {loading ? 'Executing…' : isCollapsed ? 'System Collapsed' : 'Execute Turn'}
                </button>
                <button className="mp-btn-reset" onClick={handleReset}>
                  <RotateCcw size={14} /> Reset
                </button>
              </div>
            </section>
          </>
        ) : (
          <div className="mp-empty-state">
            <p>← Select a causal graph to begin manual play</p>
          </div>
        )}
      </main>

      {/* ---- Right column: result ---- */}
      <aside className="mp-result-panel">
        {lastEntry && selectedGraph ? (
          <TurnResult
            entry={lastEntry}
            graph={selectedGraph}
            deltas={lastDeltas}
          />
        ) : (
          <div className="mp-result-empty">
            <ChevronRight size={24} style={{ opacity: 0.3 }} />
            <p>Execute a turn to see results here.</p>
            <p className="text-secondary" style={{ fontSize: 11 }}>
              Propagation path, state deltas, and failure detail will appear after each turn.
            </p>
          </div>
        )}
      </aside>

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </div>
  );
}
