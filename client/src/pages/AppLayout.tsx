import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelLeftOpen } from 'lucide-react';
import { UnifiedSidebar } from '../components/layout/UnifiedSidebar';
import { MemberList } from '../components/layout/MemberList';
import { CommandPalette } from '../components/layout/CommandPalette';
import { useUIStore } from '../stores/uiStore';
import { useGuildStore } from '../stores/guildStore';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
export function AppLayout() {
  useKeyboardNavigation();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const memberPanelOpen = useUIStore((s) => s.memberPanelOpen);
  const setMemberPanelOpen = useUIStore((s) => s.setMemberPanelOpen);
  const memberSidebarOpen = useUIStore((s) => s.memberSidebarOpen);
  const toggleMemberSidebar = useUIStore((s) => s.toggleMemberSidebar);
  const selectedGuildId = useGuildStore((s) => s.selectedGuildId);
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });

  const isSettingsRoute =
    location.pathname === '/app/settings'
    || location.pathname === '/app/admin'
    || /^\/app\/guilds\/[^/]+\/settings$/.test(location.pathname);

  const isGuildChannelRoute = /^\/app\/guilds\/[^/]+\/channels\/[^/]+$/.test(location.pathname);
  const hasTopBarRoute =
    isGuildChannelRoute
    || /^\/app\/dms(\/[^/]+)?$/.test(location.pathname);
  const showShell = !isSettingsRoute;
  const showMemberPanel = selectedGuildId && (memberPanelOpen || memberSidebarOpen) && isGuildChannelRoute && showShell;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const updateIsMobile = () => setIsMobile(mediaQuery.matches);
    updateIsMobile();
    mediaQuery.addEventListener('change', updateIsMobile);
    return () => mediaQuery.removeEventListener('change', updateIsMobile);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    setSidebarCollapsed(true);
  }, [isMobile, setSidebarCollapsed]);

  const closeMemberPanel = useCallback(() => {
    if (memberPanelOpen) setMemberPanelOpen(false);
    if (memberSidebarOpen) toggleMemberSidebar();
  }, [memberPanelOpen, memberSidebarOpen, setMemberPanelOpen, toggleMemberSidebar]);

  useEffect(() => {
    if (!isMobile) return;
    setSidebarCollapsed(true);
    setMemberPanelOpen(false);
    if (useUIStore.getState().memberSidebarOpen) {
      useUIStore.getState().toggleMemberSidebar();
    }
  }, [isMobile, location.pathname, setSidebarCollapsed, setMemberPanelOpen]);

  return (
    <div className="relative h-[100dvh] overflow-hidden px-[calc(var(--safe-left)+0.4rem)] pb-[calc(var(--safe-bottom)+0.4rem)] pt-[calc(var(--safe-top)+0.4rem)] sm:p-2 md:p-2.5">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute -left-24 top-0 h-80 w-80 rounded-full blur-[120px]" style={{ backgroundColor: 'var(--ambient-glow-primary)' }} />
      <div className="pointer-events-none absolute right-0 top-1/4 h-72 w-72 rounded-full blur-[130px]" style={{ backgroundColor: 'var(--ambient-glow-success)' }} />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-72 w-72 rounded-full blur-[150px]" style={{ backgroundColor: 'var(--ambient-glow-danger)' }} />
      {showShell && isMobile && sidebarCollapsed && !hasTopBarRoute && (
        <button
          type="button"
          className="fixed left-[calc(var(--safe-left)+0.5rem)] top-[calc(var(--safe-top)+0.5rem)] z-20 flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-bg-floating text-text-secondary shadow-md backdrop-blur-md transition-colors hover:bg-bg-mod-strong hover:text-text-primary"
          onClick={() => setSidebarCollapsed(false)}
          title="Open sidebar"
          aria-label="Open sidebar"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}

      <div className="relative flex h-full gap-1 sm:gap-2 md:gap-2.5">
        {/* Unified sidebar */}
        {showShell && !isMobile && (
          <motion.aside
            role="navigation"
            aria-label="Server navigation"
            initial={false}
            animate={{
              width: sidebarCollapsed ? 64 : 280,
            }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="glass-rail h-full shrink-0 overflow-hidden rounded-2xl"
          >
            <UnifiedSidebar />
          </motion.aside>
        )}
        <AnimatePresence>
          {showShell && isMobile && !sidebarCollapsed && (
            <>
              <motion.button
                type="button"
                aria-label="Close sidebar"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSidebarCollapsed(true)}
                className="fixed inset-0 z-30 backdrop-blur-[1px]"
                style={{ backgroundColor: 'var(--overlay-backdrop)' }}
              />
              <motion.aside
                role="navigation"
                aria-label="Server navigation"
                initial={{ x: '-105%' }}
                animate={{ x: 0 }}
                exit={{ x: '-105%' }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="glass-rail fixed bottom-[calc(var(--safe-bottom)+0.4rem)] left-[calc(var(--safe-left)+0.4rem)] top-[calc(var(--safe-top)+0.4rem)] z-40 w-[min(92vw,21rem)] overflow-hidden rounded-xl sm:rounded-2xl"
              >
                <UnifiedSidebar />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main content area */}
        <main role="main" className="flex min-w-0 flex-1" aria-label="Main content">
          {isSettingsRoute ? (
            <div className="relative h-full w-full overflow-hidden rounded-xl border border-border-subtle/70 bg-bg-tertiary/80 sm:rounded-2xl">
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
                  className="relative flex h-full flex-col"
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </div>
          ) : (
            <div className="glass-panel relative h-full w-full overflow-hidden rounded-xl sm:rounded-2xl">
              <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-border-subtle/40 sm:rounded-2xl" />
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.17, ease: [0.22, 1, 0.36, 1] }}
                  className="relative flex h-full flex-col overflow-hidden"
                >
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </main>

        {/* Member list panel */}
        {showMemberPanel && !isMobile && (
          <div role="complementary" aria-label="Member list panel" className="hidden h-full overflow-hidden rounded-2xl 2xl:block">
            <div className="glass-rail h-full overflow-hidden">
              <MemberList />
            </div>
          </div>
        )}
        <AnimatePresence>
          {showMemberPanel && isMobile && (
            <>
              <motion.button
                type="button"
                aria-label="Close member list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeMemberPanel}
                className="fixed inset-0 z-30 backdrop-blur-[1px]"
                style={{ backgroundColor: 'var(--overlay-backdrop)' }}
              />
              <motion.div
                role="complementary"
                aria-label="Member list panel"
                initial={{ x: '105%' }}
                animate={{ x: 0 }}
                exit={{ x: '105%' }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="fixed bottom-[calc(var(--safe-bottom)+0.4rem)] right-[calc(var(--safe-right)+0.4rem)] top-[calc(var(--safe-top)+0.4rem)] z-40 w-[min(92vw,21rem)] overflow-hidden rounded-xl sm:rounded-2xl"
              >
                <div className="glass-rail h-full overflow-hidden">
                  <MemberList />
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Command palette overlay */}
      <CommandPalette />
    </div>
  );
}
