/**
 * Matos Systems — Foundation Type Definitions
 * Phase 1 Application Foundation
 */

export type UserRole = 'admin' | 'dispatcher' | 'worker' | 'customer';

export interface NavigationItem {
  name: string;
  href: string;
  description: string;
  badge?: string;
}

export interface RouteMeta {
  title: string;
  description: string;
  surface: 'operator' | 'worker' | 'customer' | 'auth' | 'system';
  phase: string;
}
