import { useState, useEffect, useRef } from 'react';
import { Plus, Send, Download, Trash2, Loader2 } from 'lucide-react';
import type { ResearchSession, Message } from '../../types';
import * as api from '../../api/client';

export default function ResearchWorkbench() {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ResearchSession | null>(null);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadSessions = async () => {
    try {
      const data = await api.listSessions();
      setSessions(data);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => { loadSessions(); }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedSession?.messages]);

  const handleCreateSession = async () => {
    if (!newSessionName.trim()) return;
    try {
      const session = await api.createSession({ name: newSessionName });
      setSessions(prev => [...prev, session]);
      setSelectedSession(session);
      setShowCreateModal(false);
      setNewSessionName('');
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.deleteSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (selectedSession?.id === id) setSelectedSession(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSend = async () => {
    if (!selectedSession || !inputText.trim() || loading) return;
    const text = inputText.trim();
    setInputText('');
    setLoading(true);
    try {
      const updated = await api.chat(selectedSession.id, text);
      setSelectedSession(updated);
      setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!selectedSession) return;
    try {
      const blob = await api.exportSession(selectedSession.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session-${selectedSession.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessage = (msg: Message) => {
    if (msg.role === 'system') return null;
    return (
      <div key={msg.id} className={`message ${msg.role}`}>
        <div className="message-content">{msg.content}</div>
        <div className="message-time">
          {new Date(msg.timestamp).toLocaleTimeString()}
        </div>
      </div>
    );
  };

  return (
    <div className="page-layout" style={{ gridTemplateColumns: '240px 1fr' }}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Sessions</h2>
          <button className="btn-icon" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} />
          </button>
        </div>
        <ul className="item-list">
          {sessions.map(s => (
            <li
              key={s.id}
              className={`item-list-entry ${selectedSession?.id === s.id ? 'active' : ''}`}
              onClick={() => setSelectedSession(s)}
            >
              <span className="item-name">{s.name}</span>
              <button className="btn-icon-sm" onClick={(e) => handleDeleteSession(s.id, e)}>
                <Trash2 size={12} />
              </button>
            </li>
          ))}
          {sessions.length === 0 && (
            <li className="item-empty">No sessions yet.</li>
          )}
        </ul>
      </aside>

      <div className="chat-area">
        {selectedSession ? (
          <>
            <div className="chat-header">
              <div>
                <h3>{selectedSession.name}</h3>
                {selectedSession.graphId && (
                  <span className="text-secondary">Graph: {selectedSession.graphId}</span>
                )}
              </div>
              <button className="btn-secondary btn-sm" onClick={handleExport}>
                <Download size={14} /> Export
              </button>
            </div>

            <div className="messages-area">
              {selectedSession.messages.filter(m => m.role !== 'system').length === 0 && (
                <div className="empty-chat">
                  <p>Start a conversation about causal structures...</p>
                </div>
              )}
              {selectedSession.messages.map(renderMessage)}
              {loading && (
                <div className="message assistant loading-msg">
                  <Loader2 size={16} className="spin" />
                  <span className="text-secondary">Thinking...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-area">
              <textarea
                className="chat-input"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about causal structures... (Enter to send)"
                rows={3}
                disabled={loading}
              />
              <button
                className="btn-primary btn-send"
                onClick={handleSend}
                disabled={loading || !inputText.trim()}
              >
                <Send size={16} />
              </button>
            </div>
          </>
        ) : (
          <div className="empty-canvas">
            <p>Select or create a research session to begin</p>
          </div>
        )}
      </div>

      {error && (
        <div className="error-toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>New Research Session</h3>
            <div className="form-group">
              <label>Session Name</label>
              <input
                type="text"
                value={newSessionName}
                onChange={e => setNewSessionName(e.target.value)}
                placeholder="Session name"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreateSession()}
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreateSession}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
