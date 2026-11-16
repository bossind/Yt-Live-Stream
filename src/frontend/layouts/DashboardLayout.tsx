import {
  Bell,
  CalendarClock,
  Film,
  HardDrive,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  Settings,
  Tv,
  X,
} from 'lucide-react';
import { useEffect, useState, type ElementType, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { STUDIO_NAV_ITEMS, type StudioRouteId } from '../../shared/types/navigation';
import { ThemeLangControls } from '../components/common/ThemeLangControls';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../hooks/useLanguage';
import { cn } from '../utils/cn';

const NAV_ICONS: Record<StudioRouteId, ElementType> = {
  dashboard: LayoutDashboard,
  'live-studio': Radio,
  'video-library': Film,
  'youtube-channels': Tv,
  storage: HardDrive,
  'streaming-history': History,
  automation: CalendarClock,
  notifications: Bell,
  settings: Settings,
};

function getNavLabel(
  id: StudioRouteId,
  navDict: ReturnType<typeof useLanguage>['t']['nav']
): string {
  switch (id) {
    case 'dashboard':
      return navDict.dashboard;
    case 'live-studio':
      return navDict.liveStudio;
    case 'video-library':
      return navDict.videoLibrary;
    case 'youtube-channels':
      return navDict.youtubeChannels;
    case 'storage':
      return navDict.storage;
    case 'streaming-history':
      return navDict.streamingHistory;
    case 'automation':
      return navDict.automation;
    case 'notifications':
      return navDict.notifications;
    case 'settings':
      return navDict.settings;
  }
}

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/auth/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  const currentItem = STUDIO_NAV_ITEMS.find((item) => item.path === location.pathname);
  const currentSectionTitle = currentItem
    ? getNavLabel(currentItem.id, t.nav)
    : t.nav.dashboard;

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between bg-white dark:bg-slate-900">
      <div>
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-5 dark:border-slate-800">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2.5 text-slate-900 dark:text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-600 text-white">
              <Radio className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="truncate text-sm font-semibold tracking-tight">
              {t.brand.shortName}
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label={t.nav.closeMenu}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 lg:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Studio Navigation" className="space-y-1 p-3">
          {STUDIO_NAV_ITEMS.map((item) => {
            const Icon = NAV_ICONS[item.id];
            const label = getNavLabel(item.id, t.nav);

            return (
              <NavLink
                key={item.id}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-[44px] items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600',
                    isActive
                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-50'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                  )
                }
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </span>
                {item.phaseAvailability === 'future' ? (
                  <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500 shrink-0">
                    {item.targetPhase}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-800">
        {user ? (
          <div className="px-3 py-1">
            <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
              {user.displayName || user.email}
            </p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {user.email}
            </p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{loggingOut ? t.nav.loggingOut : t.nav.logout}</span>
        </button>

        <p className="px-3 text-[11px] text-slate-500 dark:text-slate-500">
          {t.brand.workspaceTag}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 dark:border-slate-800 lg:block">
        {sidebarContent}
      </aside>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-slate-200 shadow-xl dark:border-slate-800">
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label={t.nav.openMenu}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="hidden font-medium text-slate-500 dark:text-slate-400 sm:inline whitespace-nowrap shrink-0">
                {t.brand.name}
              </span>
              <span
                className="hidden text-slate-300 dark:text-slate-700 sm:inline"
                aria-hidden="true"
              >
                /
              </span>
              <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                {currentSectionTitle}
              </span>
            </div>
          </div>

          <ThemeLangControls variant="compact" />
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
