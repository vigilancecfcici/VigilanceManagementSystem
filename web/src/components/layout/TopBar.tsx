import { Bell } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface TopBarProps {
  breadcrumb: string;
  subtitle?: string;
  redAlertCount: number;
  onNotificationClick: () => void;
  sidebarWidth?: number;
}

export function TopBar({
  breadcrumb,
  subtitle,
  redAlertCount,
  onNotificationClick,
  sidebarWidth = 240,
}: TopBarProps) {
  const { isDark, toggleTheme } = useTheme();

  const dateTimeLabel = new Date().toLocaleString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className="vms-topbar fixed top-0 right-0 z-[1100] flex h-20 items-center justify-between border-b px-4 transition-[left] duration-300 sm:px-6"
      style={{
        left: window.innerWidth < 768 ? '0' : sidebarWidth,
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm min-w-0" data-breadcrumb>
          <span className="shrink-0 hidden sm:inline truncate" style={{ color: 'var(--text-muted)' }}>
            {breadcrumb}
          </span>
        </div>
        {subtitle ? (
          <p className="mt-1 text-xs truncate" data-breadcrumb data-live-subtitle style={{ color: 'var(--text-muted)' }}>
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="theme-toggle-btn"
        >
          {isDark ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <span className="hidden md:inline text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {dateTimeLabel}
        </span>

        <button
          type="button"
          onClick={onNotificationClick}
          data-cursor="pointer"
          aria-label={`Notifications${redAlertCount > 0 ? `, ${redAlertCount} critical` : ''}`}
          className="relative p-2 rounded-lg transition-all shrink-0 clickable"
          style={{ backgroundColor: 'var(--bg-surface)' }}
        >
          <Bell className="w-5 h-5" style={{ color: 'var(--text-primary)' }} aria-hidden />

          {redAlertCount > 0 && (
            <div
              className="absolute -top-1 -right-1 min-w-[20px] h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono px-1.5"
              style={{
                backgroundColor: 'var(--accent-red)',
                color: 'var(--text-primary)',
              }}
            >
              {redAlertCount > 99 ? '99+' : redAlertCount}
            </div>
          )}
        </button>
      </div>
    </div>
  );
}
