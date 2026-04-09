import { useState, useEffect, useCallback } from 'react';
import ReactFlow, {
  Node,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Plus, Play, RotateCcw, Trash2, ChevronRight } from 'lucide-react';
import type { CausalGraph, SimulationState, CausalNode } from '../../types';
import * as api from '../../api/client';

type NodeType = 'state' | 'event' | 'condition';

const nodeTypeColors: Record<NodeType, string> = {
  state: '#7c3aed',
  event: '#2563eb',
  condition: '#059669',
};

function toFlowNodes(
  causalNodes: CausalNode[],
  activeNodes: string[]
): Node[] {
  return causalNodes.map(n => ({
    id: n.id,
    position: n.position,
    data: { label: n.label, type: n.type, description: n.description, attributes: n.attributes },
    style: {
      background: activeNodes.includes(n.id)
        ? '#7c3aed'
        : nodeTypeColors[n.type as NodeType] || '#333',
      color: '#fff',
      border: activeNodes.includes(n.id) ? '2px solid #c4b5fd' : '1px solid #444',
      borderRadius: 8,
      padding: '8px 16px',
      fontSize: 13,
      fontWeight: activeNodes.includes(n.id) ? 700 : 400,
      boxShadow: activeNodes.includes(n.id) ? '0 0 12px #7c3aed' : 'none',
    },
  }));
}

export default function SimulationEngine() {
  const [graphs, setGraphs] = useState<CausalGraph[]>([]);
  const [selectedGraph, setSelectedGraph] = useState<CausalGraph | null>(null);
  const [simState, setSimState] = useState<SimulationState | null>(null);
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

  useEffect(() => {
    if (selectedGraph) {
      const active = simState?.activeNodes || [];
      setNodes(toFlowNodes(selectedGraph.nodes, active));
      setEdges(selectedGraph.edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: `${e.label} (${e.strength})`,
        animated: simState?.trace.at(-1)?.firedEdges.includes(e.id) || false,
        style: {
          stroke: simState?.trace.at(-1)?.firedEdges.includes(e.id) ? '#7c3aed' : '#555',
          strokeWidth: 2,
        },
        labelStyle: { fill: '#aaa', fontSize: 11 },
      })));
    }
  }, [selectedGraph, simState, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge(params, eds)),
    [setEdges]
  );

  const handleSelectGraph = async (graph: CausalGraph) => {
    setSelectedGraph(graph);
    setSimState(null);
    setSelectedNode(null);
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
    if (!selectedGraph) return;
    setLoading(true);
    try {
      const result = await api.runStep(
        selectedGraph.id,
        simState?.activeNodes,
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
      setNodes(toFlowNodes(selectedGraph.nodes, []));
    }
  };

  const handleNodeClick = (_: React.MouseEvent, node: Node) => {
    const causalNode = selectedGraph?.nodes.find(n => n.id === node.id);
    if (causalNode) setSelectedNode(causalNode);
  };

  return (
    <div className="page-layout">
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

      <aside className="right-panel">
        {selectedGraph && (
          <>
            <div className="panel-section">
              <h3>{selectedGraph.name}</h3>
              <p className="text-secondary">{selectedGraph.description}</p>
            </div>

            <div className="panel-section">
              <h4>Simulation Controls</h4>
              <div className="sim-controls">
                <button
                  className="btn-primary"
                  onClick={handleRunStep}
                  disabled={loading}
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
                    Active: {simState.activeNodes.length} nodes
                  </span>
                </div>
              )}
            </div>

            {simState && simState.trace.length > 0 && (
              <div className="panel-section trace-section">
                <h4>Simulation Trace</h4>
                <ul className="trace-list">
                  {simState.trace.map(t => (
                    <li key={t.step} className="trace-item">
                      <ChevronRight size={12} />
                      <span>Step {t.step}:</span>
                      <span className="text-secondary">
                        {t.activatedNodes.length} nodes, {t.firedEdges.length} edges
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedNode && (
              <div className="panel-section node-detail">
                <h4>Node: {selectedNode.label}</h4>
                <div className="node-type-badge" style={{ background: nodeTypeColors[selectedNode.type as NodeType] }}>
                  {selectedNode.type}
                </div>
                <p className="text-secondary">{selectedNode.description}</p>
                {Object.keys(selectedNode.attributes).length > 0 && (
                  <div className="attributes">
                    <h5>Attributes</h5>
                    {Object.entries(selectedNode.attributes).map(([k, v]) => (
                      <div key={k} className="attribute-row">
                        <span className="attr-key">{k}:</span>
                        <span className="attr-val">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {!selectedGraph && (
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
