import { Routes, Route } from 'react-router-dom';
import ViewerPage from '@/pages/ViewerPage';
import SenderPage from '@/pages/SenderPage';

/**
 * App router.
 * - `/`       → ViewerPage  (PC — runs inside Tauri window)
 * - `/sender` → SenderPage  (Phone — opened via QR code in mobile browser)
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ViewerPage />} />
      <Route path="/sender" element={<SenderPage />} />
    </Routes>
  );
}
