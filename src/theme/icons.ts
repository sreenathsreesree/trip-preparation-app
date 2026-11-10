import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

/** Icon set used across the app (Material Community Icons). */
export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
