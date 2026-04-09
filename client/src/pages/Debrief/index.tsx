/**
 * Debrief — full post-run analysis for a completed (or in-progress) simulation.
 *
 * Sections:
 *   1. Header bar — label, graph name, turns, final status
 *   2. Distortion Timeline — SVG line chart of distortion_intensity per turn
 *   3. System Pressure/Constraint chart — pressure + constraint over turns w/ threshold lines
 *   4. Irreversible Events timeline
 *   5. Turn Log table — expandable rows reusing shared sub-components
 *   6. Summary panel — aggregate counts
 *   7. Navigation — back to ManualPlay (with session pre-loaded)
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Gamepad2,
  AlertTriangle,
  Zap,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import type { SimulationState, CausalGraph, TurnLogEntry, NodeDelta } from '../../types';
import * as api from '../../api/client';
import {
  outcomeColor,
  PropagationPath,
  FailureDetail,
  NodeDeltaTable,
  PerceivedActualToggle,
  DistortionDetail,
  IrreversibleEventsLog,
  DistortionIntensityGauge,
} from '../../components/simulation/shared';

// ---------------------------------------------------------------------------
// SVG Line Chart
// ---------------------------------------------------------------------------

interface ChartSeries {
  values: number[];
  color: string;
  label: string;
}

interface ChartBand {
  yMin: number;
  yMax: number;
  color: string;
  label: string;
}

interface ChartThreshold {
  y: number;
  color: string;
  label: string;
}

interface SpikePoint {
  turn: number; // 1-indexed
}

function LineChart({
  series,
  bands,
  thresholds,
  spikes,
  height = 90,
  yLabel,
}: {
  series: ChartSeries[];
  bands?: ChartBand[];
  thresholds?: ChartThreshold[];
  spikes?: SpikePoint[];
  height?: number;
  yLabel?: string;
}) {
  const W = 520;
  const H = height;
  const pad = { top: 6, right: 12, bottom: 22, left: 32 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const maxTurns = Math.max(...series.map(s => s.values.length), 1);

  const xOf = (i: number) =>
    pad.left + (maxTurns <= 1 ? innerW / 2 : (i / (maxTurns - 1)) * innerW);

  const yOf = (v: number) => pad.top + innerH - v * innerH;

  const toPolyline = (values: number[]) =>
    values
      .map((v, i) => `${xOf(i)},${yOf(v)}`)
      .join(' ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="db-chart-svg"
      aria-label="Line chart"
    >
      {/* Color bands */}
      {bands?.map((b, i) => (
        <rect
          key={i}
          x={pad.left}
          y={yOf(b.yMax)}
          width={innerW}
          height={yOf(b.yMin) - yOf(b.yMax)}
          fill={b.color}
          opacity={0.12}
        />
      ))}

      {/* Y grid lines + labels */}
      {yTicks.map(tick => (
        <g key={tick}>
          <line
            x1={pad.left}
            x2={pad.left + innerW}
            y1={yOf(tick)}
            y2={yOf(tick)}
            stroke="#2d2d44"
            strokeWidth={0.5}
          />
          <text
            x={pad.left - 4}
            y={yOf(tick) + 3}
            fontSize={8}
            fill="#64748b"
            textAnchor="end"
          >
            {tick.toFixed(2)}
          </text>
        </g>
      ))}

      {/* X axis */}
      <line
        x1={pad.left}
        x2={pad.left + innerW}
        y1={pad.top + innerH}
        y2={pad.top + innerH}
        stroke="#2d2d44"
        strokeWidth={1}
      />

      {/* X tick labels — every turn if ≤10, else every 5 */}
      {Array.from({ length: maxTurns }, (_, i) => i).filter(i =>
        maxTurns <= 10 ? true : (i + 1) % 5 === 0 || i === 0 || i === maxTurns - 1
      ).map(i => (
        <text
          key={i}
          x={xOf(i)}
          y={pad.top + innerH + 14}
          fontSize={8}
          fill="#64748b"
          textAnchor="middle"
        >
          T{i + 1}
        </text>
      ))}

      {/* Y axis label */}
      {yLabel && (
        <text
          x={6}
          y={pad.top + innerH / 2}
          fontSize={7}
          fill="#64748b"
          textAnchor="middle"
          transform={`rotate(-90, 6, ${pad.top + innerH / 2})`}
        >
          {yLabel}
        </text>
      )}

      {/* Threshold lines */}
      {thresholds?.map((t, i) => (
        <g key={i}>
          <line
            x1={pad.left}
            x2={pad.left + innerW}
            y1={yOf(t.y)}
            y2={yOf(t.y)}
            stroke={t.color}
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.7}
          />
          <text
            x={pad.left + innerW + 2}
            y={yOf(t.y) + 3}
            fontSize={7}
            fill={t.color}
          >
            {t.label}
          </text>
        </g>
      ))}

      {/* Data lines */}
      {series.map((s, si) => (
        <polyline
          key={si}
          points={toPolyline(s.values)}
          fill="none"
          stroke={s.color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      {/* Data dots */}
      {series.map((s, si) =>
        s.values.map((v, i) => (
          <circle
            key={`${si}-${i}`}
            cx={xOf(i)}
            cy={yOf(v)}
            r={2.5}
            fill={s.color}
          />
        ))
      )}

      {/* Spike markers */}
      {spikes?.map(sp => {
        const i = sp.turn - 1;
        if (i < 0 || i >= maxTurns) return null;
        const cx = xOf(i);
        return (
          <polygon
            key={sp.turn}
            points={`${cx},${yOf(1) - 2} ${cx - 5},${yOf(1) + 7} ${cx + 5},${yOf(1) + 7}`}
            fill="#8b5cf6"
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Outcome badge
// ---------------------------------------------------------------------------

function OutcomeBadge({ outcome }: { outcome: string }) {
  const color = outcomeColor[outcome as keyof typeof outcomeColor] ?? '#6b7280';
  return (
    <span className="db-outcome-badge" style={{ background: color + '22', color, borderColor: color + '55' }}>
      {outcome.replace(/_/g, ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mini distortion gauge (compact version for table)
// ---------------------------------------------------------------------------

function MiniGauge({ intensity }: { intensity: number }) {
  const color =
    intensity < 0.3 ? '#22c55e' :
    intensity < 0.6 ? '#f59e0b' :
    '#dc2626';
  return (
    <div className="db-mini-gauge">
      <div className="db-mini-gauge-track">
        <div
          className="db-mini-gauge-fill"
          style={{ width: `${intensity * 100}%`, background: color }}
        />
      </div>
      <span className="db-mini-gauge-value" style={{ color }}>
        {(intensity * 100).toFixed(0)}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turn row — expandable
// ---------------------------------------------------------------------------

function TurnRow({
  entry,
  graph,
  deltas,
}: {
  entry: TurnLogEntry;
  graph: CausalGraph;
  deltas: NodeDelta[];
}) {
  const [expanded, setExpanded] = useState(false);
  const sourceNode = graph.nodes.find(n => n.id === entry.selected_action.source_node_id);
  const phases = entry.distortion_phases ?? [];
  const phaseColor: Record<string, string> = {
    perception: '#8b5cf6',
    targeting:  '#0ea5e9',
    effect:     '#f97316',
  };
  const percTarget = entry.perceived_target
    ? (graph.nodes.find(n => n.id === entry.perceived_target)?.label ?? entry.perceived_target)
    : null;
  const actTarget = entry.actual_target
    ? (graph.nodes.find(n => n.id === entry.actual_target)?.label ?? entry.actual_target)
    : null;
  const targetMismatch = percTarget && actTarget && percTarget !== actTarget;

  return (
    <>
      <tr
        className={`db-turn-row ${expanded ? 'db-turn-row--open' : ''}`}
        onClick={() => setExpanded(e => !e)}
      >
        <td className="db-td db-td--num">T{entry.step}</td>
        <td className="db-td">{sourceNode?.label ?? entry.selected_action.source_node_id}</td>
        <td className="db-td db-td--num">{entry.selected_action.actor_leverage.toFixed(2)}</td>
        <td className="db-td"><OutcomeBadge outcome={entry.propagation_result.outcome} /></td>
        <td className="db-td"><MiniGauge intensity={entry.distortion_intensity ?? 0} /></td>
        <td className="db-td">
          {phases.map(p => (
            <span
              key={p}
              className="db-phase-tag"
              style={{ background: phaseColor[p] + '22', color: phaseColor[p], borderColor: phaseColor[p] + '55' }}
            >
              {p}
            </span>
          ))}
        </td>
        <td className="db-td">
          {targetMismatch ? (
            <span className="db-target-mismatch" title={`Perceived: ${percTarget} / Actual: ${actTarget}`}>
              {percTarget} → {actTarget}
            </span>
          ) : (
            <span className="db-target-same">—</span>
          )}
        </td>
        <td className="db-td db-td--expand">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </td>
      </tr>
      {expanded && (
        <tr className="db-turn-detail-row">
          <td colSpan={8} className="db-turn-detail-cell">
            <div className="db-turn-detail">
              <div className="db-turn-detail-reason">
                <Info size={12} /> {entry.propagation_result.reason}
              </div>
              <div className="db-turn-detail-cols">
                <div className="db-turn-detail-col">
                  <div className="db-detail-section-title">Propagation Path</div>
                  <PropagationPath
                    edgeResults={entry.propagation_result.edge_results}
                    graph={graph}
                    entry={entry}
                  />
                </div>
                <div className="db-turn-detail-col">
                  <div className="db-detail-section-title">Node Deltas</div>
                  <NodeDeltaTable deltas={deltas} graph={graph} />
                </div>
              </div>
              {entry.triggered_failures.length > 0 && (
                <div className="db-turn-detail-section">
                  <div className="db-detail-section-title">Triggered Failures</div>
                  <FailureDetail failures={entry.triggered_failures} />
                </div>
              )}
              {phases.length > 0 && (
                <div className="db-turn-detail-section">
                  <div className="db-detail-section-title">Distortion Phases</div>
                  <DistortionDetail entry={entry} graph={graph} />
                </div>
              )}
              <div className="db-turn-detail-section">
                <DistortionIntensityGauge intensity={entry.distortion_intensity ?? 0} />
              </div>
              <div className="db-turn-detail-section">
                <div className="db-detail-section-title">State Visibility (AEIC)</div>
                <PerceivedActualToggle entry={entry} graph={graph} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Debrief() {
  const { simId } = useParams<{ simId: string }>();
  const navigate = useNavigate();

  const [sim, setSim] = useState<SimulationState | null>(null);
  const [graph, setGraph] = useState<CausalGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!simId) return;
    setLoading(true);
    api.getSimulation(simId)
      .then(async s => {
        setSim(s);
        const g = await api.getGraph(s.graphId);
        setGraph(g);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [simId]);

  if (loading) {
    return (
      <div className="db-loading">
        <div className="db-loading-spinner" />
        Loading debrief…
      </div>
    );
  }

  if (error || !sim || !graph) {
    return (
      <div className="db-error">
        <AlertTriangle size={20} />
        {error ?? 'Simulation not found.'}
        <button className="db-btn-back" onClick={() => navigate('/manual-play')}>
          <ArrowLeft size={14} /> Back to Manual Play
        </button>
      </div>
    );
  }

  const turnLog = sim.turn_log ?? [];
  const trace = sim.trace ?? [];

  // Build chart data from turn log
  const distortionValues = turnLog.map(e => e.distortion_intensity ?? 0);

  // Absolute pressure + constraint per turn (from actual_state before action)
  const pressureValues = turnLog.map(e => e.actual_state.system.pressure);
  const constraintValues = turnLog.map(e => e.actual_state.system.constraint);

  // Spike markers: turns where instability spike contributed (+0.3)
  const spikeMarkers: SpikePoint[] = turnLog
    .filter(e => (e.distortion_intensity ?? 0) >= 0.3 && e.distortion_phases?.length)
    .map(e => ({ turn: e.step }));

  // Summary counts
  const totalTurns = turnLog.length;
  const failureCounts: Record<string, number> = {};
  turnLog.forEach(e => {
    const o = e.propagation_result.outcome;
    failureCounts[o] = (failureCounts[o] ?? 0) + 1;
  });
  const totalDistortionPhases = turnLog.reduce((acc, e) => acc + (e.distortion_phases?.length ?? 0), 0);
  const cascadeTurns = turnLog.filter(e =>
    e.actual_state.system.status === 'cascade' ||
    e.propagation_result.outcome === 'cascade'
  ).length;

  const statusColor = sim.status === 'collapsed' ? '#dc2626' : sim.status === 'cascade' ? '#f97316' : '#22c55e';

  return (
    <div className="db-page">
      {/* ------------------------------------------------------------------ */}
      {/* 1. Header bar                                                       */}
      {/* ------------------------------------------------------------------ */}
      <header className="db-header">
        <button className="db-btn-back" onClick={() => navigate('/manual-play')}>
          <ArrowLeft size={14} /> Manual Play
        </button>

        <div className="db-header-info">
          <h1 className="db-header-title">{sim.label ?? `Session ${sim.id.slice(0, 8)}`}</h1>
          <div className="db-header-meta">
            <span className="db-meta-item">{graph.name}</span>
            <span className="db-meta-sep">·</span>
            <span className="db-meta-item">{totalTurns} turns</span>
            <span className="db-meta-sep">·</span>
            <span className="db-meta-status" style={{ color: statusColor }}>
              {sim.status === 'collapsed'
                ? <><AlertTriangle size={12} /> COLLAPSED</>
                : sim.status === 'cascade'
                ? <><Zap size={12} /> CASCADE</>
                : 'ACTIVE'
              }
            </span>
          </div>
        </div>

        <button
          className="db-btn-resume"
          onClick={() => navigate('/manual-play')}
          title="Load this session in Manual Play"
        >
          <Gamepad2 size={14} /> Resume in Manual Play
        </button>
      </header>

      <div className="db-body">
        {/* ---------------------------------------------------------------- */}
        {/* 2 + 3. Charts                                                     */}
        {/* ---------------------------------------------------------------- */}
        {turnLog.length > 0 && (
          <div className="db-charts-row">
            {/* Distortion Timeline */}
            <section className="db-section db-section--chart">
              <div className="db-section-title">AEIC Distortion Intensity</div>
              <div className="db-chart-legend">
                <span className="db-legend-item" style={{ color: '#22c55e' }}>● LOW &lt;0.30</span>
                <span className="db-legend-item" style={{ color: '#f59e0b' }}>● MED 0.30–0.60</span>
                <span className="db-legend-item" style={{ color: '#dc2626' }}>● HIGH &gt;0.60</span>
                {spikeMarkers.length > 0 && (
                  <span className="db-legend-item" style={{ color: '#8b5cf6' }}>▲ instability spike</span>
                )}
              </div>
              <LineChart
                series={[{ values: distortionValues, color: '#a78bfa', label: 'Distortion' }]}
                bands={[
                  { yMin: 0,    yMax: 0.30, color: '#22c55e', label: 'low' },
                  { yMin: 0.30, yMax: 0.60, color: '#f59e0b', label: 'med' },
                  { yMin: 0.60, yMax: 1.0,  color: '#dc2626', label: 'high' },
                ]}
                spikes={spikeMarkers}
                height={100}
                yLabel="intensity"
              />
            </section>

            {/* Pressure / Constraint */}
            <section className="db-section db-section--chart">
              <div className="db-section-title">System Pressure &amp; Constraint</div>
              <div className="db-chart-legend">
                <span className="db-legend-item" style={{ color: '#ef4444' }}>— Pressure</span>
                <span className="db-legend-item" style={{ color: '#f97316' }}>— Constraint</span>
                <span className="db-legend-item" style={{ color: '#f59e0b' }}>- - cascade 0.60</span>
                <span className="db-legend-item" style={{ color: '#dc2626' }}>- - collapse 0.90</span>
              </div>
              <LineChart
                series={[
                  { values: pressureValues,    color: '#ef4444', label: 'Pressure' },
                  { values: constraintValues,  color: '#f97316', label: 'Constraint' },
                ]}
                thresholds={[
                  { y: 0.6, color: '#f59e0b', label: 'cascade' },
                  { y: 0.9, color: '#dc2626', label: 'collapse' },
                ]}
                height={100}
                yLabel="value"
              />
            </section>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 4. Irreversible Events                                            */}
        {/* ---------------------------------------------------------------- */}
        {(sim.irreversible_events ?? []).length > 0 && (
          <section className="db-section">
            <div className="db-section-title">Irreversible Events</div>
            <IrreversibleEventsLog events={sim.irreversible_events} graph={graph} />
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 5. Turn Log table                                                 */}
        {/* ---------------------------------------------------------------- */}
        {turnLog.length > 0 && (
          <section className="db-section db-section--full">
            <div className="db-section-title">Turn Log</div>
            <div className="db-table-wrapper">
              <table className="db-table">
                <thead>
                  <tr>
                    <th className="db-th db-th--num">Turn</th>
                    <th className="db-th">Source Node</th>
                    <th className="db-th db-th--num">Leverage</th>
                    <th className="db-th">Outcome</th>
                    <th className="db-th">Distortion</th>
                    <th className="db-th">Phases</th>
                    <th className="db-th">Target Mismatch</th>
                    <th className="db-th db-th--expand" />
                  </tr>
                </thead>
                <tbody>
                  {turnLog.map(entry => {
                    const traceStep = trace[entry.step - 1];
                    const deltas: NodeDelta[] = traceStep?.node_deltas ?? [];
                    return (
                      <TurnRow
                        key={entry.step}
                        entry={entry}
                        graph={graph}
                        deltas={deltas}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {turnLog.length === 0 && (
          <div className="db-empty">No turns recorded for this simulation.</div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* 6. Summary panel                                                  */}
        {/* ---------------------------------------------------------------- */}
        <section className="db-section db-section--summary">
          <div className="db-section-title">Summary</div>
          <div className="db-summary-grid">
            <div className="db-summary-card">
              <div className="db-summary-value">{totalTurns}</div>
              <div className="db-summary-label">Turns Played</div>
            </div>
            <div className="db-summary-card">
              <div className="db-summary-value" style={{ color: '#22c55e' }}>
                {failureCounts['success'] ?? 0}
              </div>
              <div className="db-summary-label">Successes</div>
            </div>
            <div className="db-summary-card">
              <div className="db-summary-value" style={{ color: '#6b7280' }}>
                {failureCounts['propagation_failure'] ?? 0}
              </div>
              <div className="db-summary-label">Propagation Failures</div>
            </div>
            <div className="db-summary-card">
              <div className="db-summary-value" style={{ color: '#dc2626' }}>
                {failureCounts['correction_failure'] ?? 0}
              </div>
              <div className="db-summary-label">Correction Failures</div>
            </div>
            <div className="db-summary-card">
              <div className="db-summary-value" style={{ color: '#f97316' }}>
                {failureCounts['distortion_failure'] ?? 0}
              </div>
              <div className="db-summary-label">Distortion Failures</div>
            </div>
            <div className="db-summary-card">
              <div className="db-summary-value" style={{ color: '#f97316' }}>
                {failureCounts['cascade'] ?? 0}
              </div>
              <div className="db-summary-label">Cascade Events</div>
            </div>
            <div className="db-summary-card">
              <div className="db-summary-value" style={{ color: '#a78bfa' }}>
                {totalDistortionPhases}
              </div>
              <div className="db-summary-label">Distortion Phases Fired</div>
            </div>
            <div className="db-summary-card">
              <div className="db-summary-value" style={{ color: '#f97316' }}>
                {cascadeTurns}
              </div>
              <div className="db-summary-label">Turns in Cascade Mode</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
