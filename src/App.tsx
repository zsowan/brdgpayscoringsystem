import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider } from './hooks/ConfigContext';
import Layout from './components/Layout';
import DashboardPage from './pages/DashboardPage';
import PlaygroundPage from './pages/PlaygroundPage';
import SegmentsPage from './pages/SegmentsPage';
import DecisionEnginePage from './pages/DecisionEnginePage';
import ScoringInputsPage from './pages/ScoringInputsPage';
import HardGatesPage from './pages/HardGatesPage';
import DecisionBandsPage from './pages/DecisionBandsPage';
import CreditLimitRulesPage from './pages/CreditLimitRulesPage';
import PreapprovedMarketingPage from './pages/PreapprovedMarketingPage';
import CustomerFieldsPage from './pages/CustomerFieldsPage';
import IntegrationsPage from './pages/IntegrationsPage';
import ConfigVersionsPage from './pages/ConfigVersionsPage';
import DecisionHistoryPage from './pages/DecisionHistoryPage';
import SettingsPage from './pages/SettingsPage';
import ResultPage from './pages/ResultPage';

function App() {
  return (
    <ConfigProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/playground" element={<PlaygroundPage />} />
            <Route path="/segments" element={<SegmentsPage />} />
            <Route path="/decision-engine" element={<DecisionEnginePage />} />
            {/* Legacy single-concept pages — no longer in primary navigation (consolidated
                into /decision-engine) but kept routable since they still work and are reused
                internally (ScoringInputsPage exports BandsEditor/CategoriesEditor). */}
            <Route path="/scoring-inputs" element={<ScoringInputsPage />} />
            <Route path="/hard-gates" element={<HardGatesPage />} />
            <Route path="/decision-bands" element={<DecisionBandsPage />} />
            <Route path="/credit-limit-rules" element={<CreditLimitRulesPage />} />
            <Route path="/preapproved-marketing" element={<PreapprovedMarketingPage />} />
            <Route path="/customer-fields" element={<CustomerFieldsPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/config-versions" element={<ConfigVersionsPage />} />
            <Route path="/decision-history" element={<DecisionHistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/result/:id" element={<ResultPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
