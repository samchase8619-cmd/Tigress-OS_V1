import { Link, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { Cpu, FlaskConical } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();

  return (
    <div className="app-container">
      <nav className="nav">
        <div className="nav-brand">
          <span className="nav-logo">⬡</span>
          <span className="nav-title">Tigress OS</span>
        </div>
        <div className="nav-links">
          <Link
            to="/simulation"
            className={`nav-link ${location.pathname === '/simulation' ? 'active' : ''}`}
          >
            <Cpu size={16} />
            Simulation Engine
          </Link>
          <Link
            to="/research"
            className={`nav-link ${location.pathname === '/research' ? 'active' : ''}`}
          >
            <FlaskConical size={16} />
            Research Workbench
          </Link>
        </div>
      </nav>
      <main className="main-content">{children}</main>
    </div>
  );
}
