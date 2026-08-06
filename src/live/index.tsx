import { createRoot } from 'react-dom/client';
import LiveApp from './LiveApp';
import './live.css';

const container = document.getElementById('root');
if (container) createRoot(container).render(<LiveApp />);
