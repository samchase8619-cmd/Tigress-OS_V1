import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import SimulationEngine from './pages/SimulationEngine';
import ResearchWorkbench from './pages/ResearchWorkbench';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/simulation" replace />} />
        <Route path="/simulation" element={<SimulationEngine />} />
        <Route path="/research" element={<ResearchWorkbench />} />
      </Routes>
    </Layout>
  );
}

export default App;
