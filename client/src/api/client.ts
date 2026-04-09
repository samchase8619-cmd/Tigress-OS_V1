import type { CausalGraph, SimulationState, ResearchSession } from '../types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error || res.statusText);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// Graphs
export const listGraphs = () => request<CausalGraph[]>('/simulation/graphs');
export const createGraph = (body: { name: string; description: string }) =>
  request<CausalGraph>('/simulation/graphs', { method: 'POST', body: JSON.stringify(body) });
export const getGraph = (id: string) => request<CausalGraph>(`/simulation/graphs/${id}`);
export const updateGraph = (id: string, body: Partial<CausalGraph>) =>
  request<CausalGraph>(`/simulation/graphs/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteGraph = (id: string) =>
  request<void>(`/simulation/graphs/${id}`, { method: 'DELETE' });

// Simulations
export const runStep = (graphId: string, activeNodes?: string[], simId?: string) =>
  request<SimulationState>(`/simulation/graphs/${graphId}/simulate`, {
    method: 'POST',
    body: JSON.stringify({ activeNodes, simId }),
  });
export const listSimulations = (graphId: string) =>
  request<SimulationState[]>(`/simulation/graphs/${graphId}/simulations`);
export const getSimulation = (id: string) =>
  request<SimulationState>(`/simulation/simulations/${id}`);
export const deleteSimulation = (id: string) =>
  request<void>(`/simulation/simulations/${id}`, { method: 'DELETE' });

// Sessions
export const listSessions = () => request<ResearchSession[]>('/research/sessions');
export const createSession = (body: { name: string; graphId?: string }) =>
  request<ResearchSession>('/research/sessions', { method: 'POST', body: JSON.stringify(body) });
export const getSession = (id: string) => request<ResearchSession>(`/research/sessions/${id}`);
export const deleteSession = (id: string) =>
  request<void>(`/research/sessions/${id}`, { method: 'DELETE' });
export const chat = (sessionId: string, content: string) =>
  request<ResearchSession>(`/research/sessions/${sessionId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
export const exportSession = (id: string) =>
  fetch(`${BASE}/research/sessions/${id}/export`).then(r => r.blob());
