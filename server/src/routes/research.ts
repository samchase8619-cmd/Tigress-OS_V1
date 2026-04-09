import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import {
  CreateSessionBodySchema,
  ChatBodySchema,
  ResearchSession,
  Message,
} from '../validation/schemas';
import { readAll, readOne, writeOne, deleteOne } from '../storage/jsonStorage';

export const researchRouter = Router();

researchRouter.get('/sessions', (_req: Request, res: Response) => {
  const sessions = readAll<ResearchSession>('sessions');
  res.json(sessions);
});

researchRouter.post('/sessions', (req: Request, res: Response) => {
  const parse = CreateSessionBodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }
  const now = new Date().toISOString();
  const session: ResearchSession = {
    id: uuidv4(),
    name: parse.data.name,
    messages: [],
    graphId: parse.data.graphId,
    createdAt: now,
    updatedAt: now,
  };
  writeOne('sessions', session.id, session);
  res.status(201).json(session);
});

researchRouter.get('/sessions/:id', (req: Request, res: Response) => {
  const session = readOne<ResearchSession>('sessions', req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

researchRouter.delete('/sessions/:id', (req: Request, res: Response) => {
  const session = readOne<ResearchSession>('sessions', req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  deleteOne('sessions', req.params.id);
  res.status(204).send();
});

researchRouter.post('/sessions/:id/chat', async (req: Request, res: Response) => {
  const session = readOne<ResearchSession>('sessions', req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const parse = ChatBodySchema.safeParse({ sessionId: req.params.id, content: req.body.content });
  if (!parse.success) {
    res.status(400).json({ error: parse.error.flatten() });
    return;
  }

  const now = new Date().toISOString();
  const userMessage: Message = {
    id: uuidv4(),
    role: 'user',
    content: parse.data.content,
    timestamp: now,
  };

  const updatedMessages = [...session.messages, userMessage];

  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3';
  const ollamaMessages = [
    {
      role: 'system',
      content: 'You are a helpful RiverThorn research assistant analyzing causal structures.',
    },
    ...updatedMessages.map(m => ({ role: m.role, content: m.content })),
  ];

  try {
    const ollamaResponse = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        messages: ollamaMessages,
        stream: false,
      }),
    });

    if (!ollamaResponse.ok) {
      const errText = await ollamaResponse.text();
      res.status(502).json({ error: `Ollama error: ${errText}` });
      return;
    }

    const ollamaData = await ollamaResponse.json() as { message?: { content?: string } };
    const assistantContent = ollamaData?.message?.content || 'No response from Ollama.';

    const assistantMessage: Message = {
      id: uuidv4(),
      role: 'assistant',
      content: assistantContent,
      timestamp: new Date().toISOString(),
    };

    const finalSession: ResearchSession = {
      ...session,
      messages: [...updatedMessages, assistantMessage],
      updatedAt: new Date().toISOString(),
    };

    writeOne('sessions', finalSession.id, finalSession);
    res.json(finalSession);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Failed to connect to Ollama: ${message}` });
  }
});

researchRouter.get('/sessions/:id/export', (req: Request, res: Response) => {
  const session = readOne<ResearchSession>('sessions', req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.setHeader('Content-Disposition', `attachment; filename="session-${session.id}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(session, null, 2));
});
