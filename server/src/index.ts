import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { simulationRouter } from './routes/simulation';
import { researchRouter } from './routes/research';
import { ensureDir } from './storage/jsonStorage';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

ensureDir();

app.use('/api/simulation', simulationRouter);
app.use('/api/research', researchRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Tigress OS server running on port ${PORT}`);
});
