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
import { useNavigate } from 'react-router-dom';
import {
  Play,
  RotateCcw,
  ChevronRight,
  AlertTriangle,
  Zap,
  Lock,
  Swords,
  FlaskConical,
  Shield,
  Info,
  Save,
  FolderOpen,
  BarChart2,
} from 'lucide-react';
import type {
  CausalGraph,
  SimulationState,
  TurnLogEntry,
  NodeDelta,
} from '../../types';
import * as api from '../../api/client';
import {
  clamp,
  outcomeColor,
  StatBar,
  PropagationPath,
  FailureDetail,
  NodeDeltaTable,
  PerceivedActualToggle,
  DistortionDetail,
  IrreversibleEventsLog,
  DistortionIntensityGauge,
} from '../../components/simulation/shared';

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


function TurnResult({
  entry,
  graph,
  deltas,
}: {  entry: TurnLogEntry;
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

      {/* Distortion intensity gauge */}
      <DistortionIntensityGauge intensity={entry.distortion_intensity ?? 0} />
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

      {/* Distortion phase breakdown */}
      {(entry.distortion_phases ?? []).length > 0 && (
        <div className="mp-result-section">
          <div className="mp-result-section-title">Distortion Phases</div>
          <DistortionDetail entry={entry} graph={graph} />
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
  const navigate = useNavigate();
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

  // Session save / load
  const [allSessions, setAllSessions] = useState<SimulationState[]>([]);
  const [saveLabel, setSaveLabel] = useState('');
  const [savingLabel, setSavingLabel] = useState(false);
  const [showSessions, setShowSessions] = useState(false);

  useEffect(() => {
    api.listGraphs().then(setGraphs).catch(e => setError(String(e)));
    api.listAllSimulations().then(setAllSessions).catch(() => {/* non-fatal */});
  }, []);

  const refreshSessions = () =>
    api.listAllSimulations().then(setAllSessions).catch(() => {});

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

  const handleSaveSession = async () => {
    if (!simState || !saveLabel.trim()) return;
    setSavingLabel(true);
    try {
      await api.labelSimulation(simState.id, saveLabel.trim());
      setSaveLabel('');
      await refreshSessions();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingLabel(false);
    }
  };

  const handleLoadSession = async (session: SimulationState) => {
    try {
      // Resolve the graph this session was run on
      const graph = graphs.find(g => g.id === session.graphId) ?? await api.getGraph(session.graphId);
      setSelectedGraph(graph);
      setSimState(session);
      setLastEntry(session.turn_log.at(-1) ?? null);
      setLastDeltas(session.trace.at(-1)?.node_deltas ?? []);
      setSelectedSourceId(graph.nodes[0]?.id ?? null);
      setShowSessions(false);
    } catch (e) {
      setError(String(e));
    }
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
        <div className="mp-sidebar-header">
          <h2 className="mp-sidebar-title">Graphs</h2>
          <button
            className="mp-btn-sessions"
            onClick={() => setShowSessions(s => !s)}
            title="Load saved session"
          >
            <FolderOpen size={14} />
          </button>
        </div>

        {/* Session loader */}
        {showSessions && (
          <div className="mp-session-list">
            <div className="mp-session-list-title">Saved Sessions</div>
            {allSessions.length === 0 && (
              <p className="mp-session-empty">No saved sessions yet.</p>
            )}
            {allSessions.filter(s => s.label).map(s => {
              const gName = graphs.find(g => g.id === s.graphId)?.name ?? s.graphId;
              return (
                <div key={s.id} className="mp-session-row">
                  <button
                    className="mp-session-item"
                    onClick={() => handleLoadSession(s)}
                  >
                    <span className="mp-session-label">{s.label}</span>
                    <span className="mp-session-meta">{gName} · T{s.step}</span>
                  </button>
                  <button
                    className="mp-btn-debrief-sm"
                    title="View Debrief"
                    onClick={() => navigate(`/debrief/${s.id}`)}
                  >
                    <BarChart2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

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
            {simState.instability_spike_active && (
              <div className="mp-status-badge mp-status-badge--spike">
                <Zap size={11} /> INSTABILITY SPIKE
              </div>
            )}
            <div className="mp-sys-step">Turn {simState.step}</div>

            {/* Current distortion intensity (from last turn log entry) */}
            {(() => {
              const lastIntensity = simState.turn_log.at(-1)?.distortion_intensity;
              return lastIntensity !== undefined
                ? <DistortionIntensityGauge intensity={lastIntensity} />
                : null;
            })()}

            {/* Irreversible events */}
            {selectedGraph && (simState.irreversible_events ?? []).length > 0 && (
              <IrreversibleEventsLog
                events={simState.irreversible_events}
                graph={selectedGraph}
              />
            )}
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

              {/* Session save */}
              {simState && (
                <div className="mp-save-row">
                  <input
                    className="mp-save-input"
                    placeholder="Session name…"
                    value={saveLabel}
                    onChange={e => setSaveLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveSession(); }}
                  />
                  <button
                    className="mp-btn-save"
                    onClick={handleSaveSession}
                    disabled={savingLabel || !saveLabel.trim()}
                  >
                    <Save size={13} /> {savingLabel ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    className="mp-btn-debrief"
                    onClick={() => navigate(`/debrief/${simState.id}`)}
                    title="View full debrief for this session"
                  >
                    <BarChart2 size={13} /> Debrief
                  </button>
                </div>
              )}
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
