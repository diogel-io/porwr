import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/sidebar',
    component: () => import('layouts/sidebar/Layout.vue'),
    children: [
      {
        path: '',
        name: 'sidebar',
        component: () => import('pages/sidebar/SidebarHome.vue'),
      },
    ],
  },
  {
    // The toolbar popup was retired with the sidebar (ADR D3). Anything still holding the old
    // URL lands on the panel rather than a not-found page.
    path: '/popup',
    redirect: { name: 'sidebar' },
  },
  {
    path: '/login',
    component: () => import('layouts/extension/LoginLayout.vue'),
    children: [
      {
        path: '',
        name: 'login',
        component: () => import('pages/extension/VaultLogin.vue'),
      },
    ],
  },
  {
    path: '/dashboard',
    component: () => import('layouts/dashboard/Layout.vue'),
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('pages/dashboard/DashboardPage.vue'),
      },
    ],
  },
  {
    path: '/media',
    component: () => import('layouts/dashboard/Layout.vue'),
    children: [
      {
        path: '',
        name: 'media-management',
        component: () => import('pages/dashboard/MediaManagementPage.vue'),
      },
    ],
  },
  {
    path: '/settings',
    component: () => import('layouts/dashboard/Layout.vue'),
    children: [
      {
        path: '',
        name: 'settings',
        component: () => import('pages/dashboard/ExtensionSettings.vue'),
      },
    ],
  },
  {
    path: '/profile',
    component: () => import('layouts/dashboard/Layout.vue'),
    children: [
      {
        path: '',
        name: 'profile',
        component: () => import('pages/dashboard/ProfilePage.vue'),
      },
    ],
  },
  {
    path: '/relays',
    component: () => import('layouts/dashboard/Layout.vue'),
    children: [
      {
        path: '',
        name: 'relays',
        component: () => import('pages/dashboard/RelayManagementPage.vue'),
      },
    ],
  },
  {
    path: '/contacts',
    component: () => import('layouts/dashboard/Layout.vue'),
    children: [
      {
        path: '',
        name: 'contacts',
        component: () => import('pages/dashboard/ContactListPage.vue'),
      },
    ],
  },
  {
    path: '/wallet-connections',
    component: () => import('layouts/dashboard/Layout.vue'),
    children: [
      {
        path: '',
        name: 'wallet-connections',
        component: () => import('pages/dashboard/WalletConnectionsPage.vue'),
      },
    ],
  },
  {
    path: '/keys',
    component: () => import('layouts/dashboard/Layout.vue'),
    children: [
      {
        path: 'import',
        name: 'import-key',
        component: () => import('pages/dashboard/ImportKeyPage.vue'),
      },
      {
        path: 'new',
        name: 'add-new-key',
        component: () => import('pages/dashboard/AddNewKeyPage.vue'),
      },
      {
        path: ':alias',
        name: 'view-key',
        component: () => import('pages/dashboard/ViewKeyPage.vue'),
        props: true,
      },
      {
        path: '',
        name: 'keys',
        component: () => import('pages/dashboard/KeyManagementPage.vue'),
      },
    ],
  },
  {
    path: '/connected-sites',
    component: () => import('layouts/dashboard/Layout.vue'),
    children: [
      {
        path: '',
        name: 'connected-sites',
        component: () => import('pages/dashboard/ConnectedSitesPage.vue'),
      },
    ],
  },
  {
    path: '/event-history',
    component: () => import('layouts/dashboard/Layout.vue'),
    children: [
      {
        path: '',
        name: 'event-history',
        component: () => import('pages/dashboard/ViewLogs.vue'),
      },
    ],
  },
  {
    path: '/logs',
    redirect: { name: 'event-history' },
  },
  {
    path: '/edit-account/:alias?',
    redirect: (to) => {
      const alias = typeof to.params.alias === 'string' ? to.params.alias : undefined;
      if (alias) {
        return { name: 'view-key', params: { alias } };
      }

      return { name: 'keys' };
    },
  },
  {
    path: '/create-account',
    name: 'create-account',
    redirect: { name: 'add-new-key' },
  },
  {
    path: '/',
    component: () => import('layouts/extension/Layout.vue'),
    children: [
      {
        path: '',
        name: 'home',
        component: () => import('pages/extension/IndexPage.vue'),
      },
    ],
  },
  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/extension/ErrorNotFound.vue'),
  },
];

export default routes;
