import { useState, useEffect, useCallback } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Plus, Play, RotateCcw, Trash2, ChevronRight, AlertTriangle, Zap, Lock } from 'lucide-react';
import type {
  CausalGraph,
  CausalNode,
  CausalEdge,
  SimulationState,
  NodeState,
  StepOutcome,
  SystemState,
} from '../../types';
import * as api from '../../api/client';

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
type NodeType = 'state' | 'event' | 'condition' | 'actor';

const typeColor: Record<NodeType, string> = {
  state: '#7c3aed',
  event: '#2563eb',
  condition: '#059669',
  actor: '#b45309',
};

/** Map constraint_level (0-1) to a red-shift overlay on the base colour. */
function constraintColor(base: string, constraint: number): string {
  // Blend toward #dc2626 (red) as constraint increases
  return constraint > 0.6 ? '#dc2626' : constraint > 0.35 ? '#ea580c' : base;
}

function toFlowNodes(
  causalNodes: CausalNode[],
  nodeStates: Record<string, NodeState>,
  selectedSourceId: string | null
): Node[] {
  return causalNodes.map(n => {
    const state = nodeStates[n.id] ?? {
      stability: n.stability,
      constraint_level: n.constraint_level,
      locked: n.locked,
    };
    const base = typeColor[n.type as NodeType] ?? '#333';
    const bg = state.locked ? '#4b5563' : constraintColor(base, state.constraint_level);
    const isSource = n.id === selectedSourceId;

    return {
      id: n.id,
      position: n.position,
      data: {
        label: `${state.locked ? '🔒 ' : ''}${n.label}`,
        type: n.type,
        description: n.description,
        state,
        actor_leverage: n.actor_leverage,
      },
      style: {
        background: bg,
        color: '#fff',
        border: isSource
          ? '2px solid #fbbf24'
          : state.locked
          ? '2px solid #6b7280'
          : `1px solid ${bg}`,
        borderRadius: 8,
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: isSource ? 700 : 400,
        boxShadow: isSource
          ? '0 0 14px #fbbf24'
          : state.constraint_level > 0.5
          ? '0 0 8px #dc2626'
          : 'none',
        opacity: state.locked ? 0.6 : 1,
      },
    };
  });
}

function toFlowEdges(
  causalEdges: CausalEdge[],
  lastEdgeResults: SimulationState['trace'][number]['edge_results'] | undefined
): Edge[] {
  return causalEdges.map(e => {
    const result = lastEdgeResults?.find(r => r.edge_id === e.id);
    const outcomeColor: Record<string, string> = {
      success: '#22c55e',
      propagation_failure: '#6b7280',
      correction_failure: '#dc2626',
      distortion_failure: '#f97316',
    };
    const stroke = result ? (outcomeColor[result.outcome] ?? '#555') : '#555';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: `${e.label} (cost:${e.propagation_cost.toFixed(1)} open:${e.openness.toFixed(1)})`,
      animated: result?.outcome === 'success',
      style: { stroke, strokeWidth: result ? 2.5 : 1.5 },
      labelStyle: { fill: result ? stroke : '#888', fontSize: 10 },
    };
  });
}

// ---------------------------------------------------------------------------
// System pressure gauge
// ---------------------------------------------------------------------------
function SystemGauge({ system }: { system: SystemState }) {
  const pct = Math.round(system.pressure * 100);
  const color =
    system.status === 'collapsed'
      ? '#dc2626'
      : system.status === 'cascade'
      ? '#f97316'
      : system.pressure > 0.4
      ? '#eab308'
      : '#22c55e';

  return (
    <div className="system-gauge">
      <div className="gauge-row">
        <span className="gauge-label">Pressure</span>
        <span className="gauge-value" style={{ color }}>{pct}%</span>
      </div>
      <div className="gauge-bar-bg">
        <div className="gauge-bar-fill" style={{ width: `${pct}%`, background: color }} />
        <div
          className="gauge-threshold"
          style={{ left: `${system.thresholds.cascade * 100}%` }}
          title="cascade threshold"
        />
        <div
          className="gauge-threshold gauge-threshold--collapse"
          style={{ left: `${system.thresholds.collapse * 100}%` }}
          title="collapse threshold"
        />
      </div>
      <div className="gauge-row gauge-row--small">
        <span className="gauge-label">Recovery</span>
        <span className="gauge-value">{Math.round(system.recovery_capacity * 100)}%</span>
      </div>
      <div className="gauge-bar-bg">
        <div
          className="gauge-bar-fill"
          style={{ width: `${system.recovery_capacity * 100}%`, background: '#7c3aed' }}
        />
      </div>
      {system.status !== 'active' && (
        <div className={`status-badge status-badge--${system.status}`}>
          {system.status === 'cascade' ? (
            <><Zap size={12} /> CASCADE</>
          ) : (
            <><AlertTriangle size={12} /> COLLAPSED</>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outcome label
// ---------------------------------------------------------------------------
const outcomeStyle: Record<StepOutcome, string> = {
  success: '#22c55e',
  propagation_failure: '#6b7280',
  correction_failure: '#dc2626',
  distortion_failure: '#f97316',
  cascade: '#f97316',
  collapse: '#dc2626',
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function SimulationEngine() {
  const [graphs, setGraphs] = useState<CausalGraph[]>([]);
  const [selectedGraph, setSelectedGraph] = useState<CausalGraph | null>(null);
  const [simState, setSimState] = useState<SimulationState | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [actorLeverage, setActorLeverage] = useState<number>(0.5);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<CausalNode | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGraphName, setNewGraphName] = useState('');
  const [newGraphDesc, setNewGraphDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGraphs = async () => {
    try {
      const data = await api.listGraphs();
      setGraphs(data);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => { loadGraphs(); }, []);

  // Sync flow nodes/edges whenever graph or simulation state changes
  useEffect(() => {
    if (!selectedGraph) return;
    const ns = simState?.node_states ?? {};
    const lastStep = simState?.trace.at(-1);
    setNodes(toFlowNodes(selectedGraph.nodes, ns, selectedSourceId));
    setEdges(toFlowEdges(selectedGraph.edges, lastStep?.edge_results));
  }, [selectedGraph, simState, selectedSourceId, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge(params, eds)),
    [setEdges]
  );

  const handleSelectGraph = (graph: CausalGraph) => {
    setSelectedGraph(graph);
    setSimState(null);
    setSelectedNode(null);
    setSelectedSourceId(graph.nodes[0]?.id ?? null);
    setActorLeverage(graph.nodes[0]?.actor_leverage ?? 0.5);
  };

  const handleCreateGraph = async () => {
    if (!newGraphName.trim()) return;
    try {
      const g = await api.createGraph({ name: newGraphName, description: newGraphDesc });
      setGraphs(prev => [...prev, g]);
      setShowCreateModal(false);
      setNewGraphName('');
      setNewGraphDesc('');
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteGraph = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteGraph(id);
      setGraphs(prev => prev.filter(g => g.id !== id));
      if (selectedGraph?.id === id) {
        setSelectedGraph(null);
        setSimState(null);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleRunStep = async () => {
    if (!selectedGraph || !selectedSourceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.runStep(
        selectedGraph.id,
        selectedSourceId,
        actorLeverage,
        simState?.id
      );
      setSimState(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSimState(null);
    if (selectedGraph) {
      setNodes(toFlowNodes(selectedGraph.nodes, {}, selectedSourceId));
      setEdges(toFlowEdges(selectedGraph.edges, undefined));
    }
  };

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    const cn = selectedGraph?.nodes.find(n => n.id === node.id) ?? null;
    if (cn) {
      setSelectedNode(cn);
      setSelectedSourceId(cn.id);
      setActorLeverage(cn.actor_leverage);
    }
  };

  return (
    <div className="page-layout">
      {/* ---- Sidebar ---- */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Causal Graphs</h2>
          <button className="btn-icon" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} />
          </button>
        </div>
        <ul className="item-list">
          {graphs.map(g => (
            <li
              key={g.id}
              className={`item-list-entry ${selectedGraph?.id === g.id ? 'active' : ''}`}
              onClick={() => handleSelectGraph(g)}
            >
              <span className="item-name">{g.name}</span>
              <button className="btn-icon-sm" onClick={(e) => handleDeleteGraph(g.id, e)}>
                <Trash2 size={12} />
              </button>
            </li>
          ))}
          {graphs.length === 0 && (
            <li className="item-empty">No graphs yet. Create one!</li>
          )}
        </ul>
      </aside>

      {/* ---- Canvas ---- */}
      <div className="canvas-area">
        {selectedGraph ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            fitView
          >
            <Background color="#222" gap={16} />
            <Controls />
            <MiniMap nodeColor="#7c3aed" maskColor="rgba(0,0,0,0.7)" />
          </ReactFlow>
        ) : (
          <div className="empty-canvas">
            <p>Select a causal graph to begin</p>
          </div>
        )}
      </div>

      {/* ---- Right panel ---- */}
      <aside className="right-panel">
        {selectedGraph ? (
          <>
            <div className="panel-section">
              <h3>{selectedGraph.name}</h3>
              <p className="text-secondary">{selectedGraph.description}</p>
            </div>

            {/* System gauge */}
            {simState && (
              <div className="panel-section">
                <h4>System State</h4>
                <SystemGauge system={simState.system} />
              </div>
            )}

            {/* Simulation controls */}
            <div className="panel-section">
              <h4>Simulation Controls</h4>

              {/* Source node selector */}
              <div className="form-group form-group--compact">
                <label>Source node</label>
                <select
                  value={selectedSourceId ?? ''}
                  onChange={e => {
                    setSelectedSourceId(e.target.value);
                    const n = selectedGraph.nodes.find(n => n.id === e.target.value);
                    if (n) setActorLeverage(n.actor_leverage);
                  }}
                >
                  {selectedGraph.nodes.map(n => (
                    <option key={n.id} value={n.id} disabled={
                      (simState?.node_states[n.id]?.locked) ?? n.locked
                    }>
                      {(simState?.node_states[n.id]?.locked ?? n.locked) ? '🔒 ' : ''}{n.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Actor leverage slider */}
              <div className="form-group form-group--compact">
                <label>Actor leverage: <strong>{actorLeverage.toFixed(2)}</strong></label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={actorLeverage}
                  onChange={e => setActorLeverage(Number(e.target.value))}
                />
              </div>

              <div className="sim-controls">
                <button
                  className="btn-primary"
                  onClick={handleRunStep}
                  disabled={loading || !selectedSourceId || simState?.status === 'collapsed'}
                >
                  <Play size={14} /> {loading ? 'Running...' : 'Run Step'}
                </button>
                <button className="btn-secondary" onClick={handleReset}>
                  <RotateCcw size={14} /> Reset
                </button>
              </div>

              {simState && (
                <div className="sim-info">
                  <span className="badge">Step {simState.step}</span>
                  <span className="text-secondary">
                    {Object.values(simState.node_states).filter(n => n.locked).length} locked
                  </span>
                </div>
              )}
            </div>

            {/* Trace */}
            {simState && simState.trace.length > 0 && (
              <div className="panel-section trace-section">
                <h4>Propagation Trace</h4>
                <ul className="trace-list">
                  {simState.trace.slice().reverse().map(t => (
                    <li key={t.step} className="trace-item">
                      <ChevronRight size={12} />
                      <span>Step {t.step}:</span>
                      <span
                        className="trace-outcome"
                        style={{ color: outcomeStyle[t.step_outcome] }}
                      >
                        {t.step_outcome.replace(/_/g, ' ')}
                      </span>
                      <span className="text-secondary trace-sub">
                        {t.edge_results.length} edges · leverage {t.action.actor_leverage.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Node detail */}
            {selectedNode && (
              <div className="panel-section node-detail">
                <h4>Node: {selectedNode.label}</h4>
                <div
                  className="node-type-badge"
                  style={{ background: typeColor[selectedNode.type as NodeType] }}
                >
                  {selectedNode.type}
                </div>
                <p className="text-secondary">{selectedNode.description}</p>
                {(() => {
                  const ns = simState?.node_states[selectedNode.id];
                  const stability = ns?.stability ?? selectedNode.stability;
                  const constraint = ns?.constraint_level ?? selectedNode.constraint_level;
                  const locked = ns?.locked ?? selectedNode.locked;
                  return (
                    <div className="node-stats">
                      <div className="stat-row">
                        <span>Stability</span>
                        <div className="mini-bar">
                          <div style={{ width: `${stability * 100}%`, background: '#22c55e' }} />
                        </div>
                        <span>{(stability * 100).toFixed(0)}%</span>
                      </div>
                      <div className="stat-row">
                        <span>Constraint</span>
                        <div className="mini-bar">
                          <div style={{ width: `${constraint * 100}%`, background: '#dc2626' }} />
                        </div>
                        <span>{(constraint * 100).toFixed(0)}%</span>
                      </div>
                      <div className="stat-row">
                        <span>Leverage</span>
                        <div className="mini-bar">
                          <div style={{ width: `${selectedNode.actor_leverage * 100}%`, background: '#7c3aed' }} />
                        </div>
                        <span>{(selectedNode.actor_leverage * 100).toFixed(0)}%</span>
                      </div>
                      {locked && (
                        <div className="lock-warning">
                          <Lock size={12} /> Node is locked
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        ) : (
          <div className="panel-empty">
            <p>Select a graph to view controls</p>
          </div>
        )}
      </aside>

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Create Causal Graph</h3>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={newGraphName}
                onChange={e => setNewGraphName(e.target.value)}
                placeholder="Graph name"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={newGraphDesc}
                onChange={e => setNewGraphDesc(e.target.value)}
                placeholder="Describe this causal graph..."
                rows={3}
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreateGraph}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
