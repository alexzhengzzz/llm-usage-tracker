import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { UsagePage } from './components/UsagePage';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100">
        <Routes>
          <Route path="/" element={<UsagePage />} />
          <Route path="/usage" element={<UsagePage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;