import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import SessionView from './pages/SessionView';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/session/:code" element={<SessionView />} />
    </Routes>
  );
}
