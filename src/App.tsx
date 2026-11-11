import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useSettings, applyThemeClass } from './store/useSettings';
import ShelfPage from './pages/ShelfPage';
import ReaderPage from './pages/ReaderPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    applyThemeClass(theme);
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => applyThemeClass('system');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, [theme]);

  return (
    <Routes>
      <Route path="/" element={<ShelfPage />} />
      <Route path="/read/:id" element={<ReaderPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<ShelfPage />} />
    </Routes>
  );
}
