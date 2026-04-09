import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import SimulationEngine from './pages/SimulationEngine';
import ResearchWorkbench from './pages/ResearchWorkbench';
import ManualPlay from './pages/ManualPlay';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/simulation" replace />} />
        <Route path="/simulation" element={<SimulationEngine />} />
        <Route path="/research" element={<ResearchWorkbench />} />
        <Route path="/manual-play" element={<ManualPlay />} />
      </Routes>
    </Layout>
  );
}

export default App;
