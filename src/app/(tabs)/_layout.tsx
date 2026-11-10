import { Tabs } from 'expo-router/js-tabs';

import {
  ExpeditionTabBar,
  type TabIconSet,
} from '@/components/navigation/ExpeditionTabBar';
import { colors } from '@/theme';

const TAB_ICONS: Record<string, TabIconSet> = {
  index: { icon: 'home-variant-outline', activeIcon: 'home-variant' },
  trips: { icon: 'map-marker-path', activeIcon: 'map-marker-path' },
  inventory: { icon: 'bag-personal-outline', activeIcon: 'bag-personal' },
  checklists: { icon: 'clipboard-check-outline', activeIcon: 'clipboard-check' },
  profile: { icon: 'account-circle-outline', activeIcon: 'account-circle' },
};

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <ExpeditionTabBar {...props} icons={TAB_ICONS} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="trips" options={{ title: 'Trips' }} />
      <Tabs.Screen name="inventory" options={{ title: 'Inventory' }} />
      <Tabs.Screen name="checklists" options={{ title: 'Checklists' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
