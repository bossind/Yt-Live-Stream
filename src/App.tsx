import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './frontend/components/auth/ProtectedRoute';
import { AuthProvider } from './frontend/contexts/AuthContext';
import { LanguageProvider } from './frontend/contexts/LanguageContext';
import { ThemeProvider } from './frontend/contexts/ThemeContext';
import { DashboardLayout } from './frontend/layouts/DashboardLayout';
import { AuthLoginPage } from './frontend/pages/AuthLoginPage';
import { AutomationPage } from './frontend/pages/AutomationPage';
import { DashboardPage } from './frontend/pages/DashboardPage';
import { ForgotPasswordPage } from './frontend/pages/ForgotPasswordPage';
import { LiveStudioPage } from './frontend/pages/LiveStudioPage';
import { NotificationsPage } from './frontend/pages/NotificationsPage';
import { SettingsPage } from './frontend/pages/SettingsPage';
import { StoragePage } from './frontend/pages/StoragePage';
import { StreamingHistoryPage } from './frontend/pages/StreamingHistoryPage';
import { VideoLibraryPage } from './frontend/pages/VideoLibraryPage';
import { YouTubeChannelsPage } from './frontend/pages/YouTubeChannelsPage';

function ProtectedStudioPage({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <DashboardLayout>{children}</DashboardLayout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Public Authentication Routes (No Public Registration) */}
              <Route path="/auth/login" element={<AuthLoginPage />} />
              <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />

              {/* Protected Single-Admin Studio Routes */}
              <Route
                path="/"
                element={
                  <ProtectedStudioPage>
                    <DashboardPage />
                  </ProtectedStudioPage>
                }
              />
              <Route
                path="/live-studio"
                element={
                  <ProtectedStudioPage>
                    <LiveStudioPage />
                  </ProtectedStudioPage>
                }
              />
              <Route
                path="/video-library"
                element={
                  <ProtectedStudioPage>
                    <VideoLibraryPage />
                  </ProtectedStudioPage>
                }
              />
              <Route
                path="/youtube-channels"
                element={
                  <ProtectedStudioPage>
                    <YouTubeChannelsPage />
                  </ProtectedStudioPage>
                }
              />
              <Route
                path="/storage"
                element={
                  <ProtectedStudioPage>
                    <StoragePage />
                  </ProtectedStudioPage>
                }
              />
              <Route
                path="/streaming-history"
                element={
                  <ProtectedStudioPage>
                    <StreamingHistoryPage />
                  </ProtectedStudioPage>
                }
              />
              <Route
                path="/automation"
                element={
                  <ProtectedStudioPage>
                    <AutomationPage />
                  </ProtectedStudioPage>
                }
              />
              <Route
                path="/notifications"
                element={
                  <ProtectedStudioPage>
                    <NotificationsPage />
                  </ProtectedStudioPage>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedStudioPage>
                    <SettingsPage />
                  </ProtectedStudioPage>
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
