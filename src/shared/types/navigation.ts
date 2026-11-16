export type StudioRouteId =
  | 'dashboard'
  | 'live-studio'
  | 'video-library'
  | 'youtube-channels'
  | 'storage'
  | 'streaming-history'
  | 'automation'
  | 'notifications'
  | 'settings';

export interface StudioNavItem {
  id: StudioRouteId;
  path: string;
  labelKey: string;
  phaseAvailability: 'available' | 'future';
  targetPhase: string;
}

export const STUDIO_NAV_ITEMS: StudioNavItem[] = [
  {
    id: 'dashboard',
    path: '/',
    labelKey: 'nav.dashboard',
    phaseAvailability: 'available',
    targetPhase: 'Phase 1',
  },
  {
    id: 'live-studio',
    path: '/live-studio',
    labelKey: 'nav.liveStudio',
    phaseAvailability: 'future',
    targetPhase: 'Phase 4',
  },
  {
    id: 'video-library',
    path: '/video-library',
    labelKey: 'nav.videoLibrary',
    phaseAvailability: 'future',
    targetPhase: 'Phase 3',
  },
  {
    id: 'youtube-channels',
    path: '/youtube-channels',
    labelKey: 'nav.youtubeChannels',
    phaseAvailability: 'future',
    targetPhase: 'Phase 3',
  },
  {
    id: 'storage',
    path: '/storage',
    labelKey: 'nav.storage',
    phaseAvailability: 'future',
    targetPhase: 'Phase 3',
  },
  {
    id: 'streaming-history',
    path: '/streaming-history',
    labelKey: 'nav.streamingHistory',
    phaseAvailability: 'future',
    targetPhase: 'Phase 4',
  },
  {
    id: 'automation',
    path: '/automation',
    labelKey: 'nav.automation',
    phaseAvailability: 'future',
    targetPhase: 'Phase 5',
  },
  {
    id: 'notifications',
    path: '/notifications',
    labelKey: 'nav.notifications',
    phaseAvailability: 'future',
    targetPhase: 'Phase 5',
  },
  {
    id: 'settings',
    path: '/settings',
    labelKey: 'nav.settings',
    phaseAvailability: 'available',
    targetPhase: 'Phase 1',
  },
];
