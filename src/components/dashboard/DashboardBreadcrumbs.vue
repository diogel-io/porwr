<script lang="ts" setup>
import { useI18n } from 'vue-i18n';
import type { RouteLocationRaw } from 'vue-router';

/**
 * Where a dashboard sub-page sits, and the way back up (#302).
 *
 * The Keys sub-pages were dead ends: the only route back to the list was the navigation menu.
 * Plain markup rather than `q-breadcrumbs`, which renders neither a `nav` landmark nor
 * `aria-current`, so a screen reader could not tell the trail from any other row of links.
 *
 * The last item is the current page and is never a link, whether or not it is given a `to`.
 */
export interface BreadcrumbItem {
  label: string;
  to?: RouteLocationRaw;
}

defineOptions({ name: 'DashboardBreadcrumbs' });

defineProps<{
  items: BreadcrumbItem[];
}>();

const { t } = useI18n();
</script>

<template>
  <nav :aria-label="t('navigation.breadcrumb')" class="dashboard-breadcrumbs">
    <ol class="dashboard-breadcrumbs__list">
      <li v-for="(item, index) in items" :key="index" class="dashboard-breadcrumbs__item">
        <router-link
          v-if="item.to && index < items.length - 1"
          :to="item.to"
          class="dashboard-breadcrumbs__link"
        >
          {{ item.label }}
        </router-link>
        <span v-else aria-current="page" class="dashboard-breadcrumbs__current">
          {{ item.label }}
        </span>
        <span
          v-if="index < items.length - 1"
          aria-hidden="true"
          class="dashboard-breadcrumbs__separator"
        >
          ›
        </span>
      </li>
    </ol>
  </nav>
</template>

<style scoped lang="scss">
/*
 * `min-width: 0` all the way down: this is a grid child of `.dashboard-page`, and a long alias
 * would otherwise widen the grid track and the page with it rather than ellipsising.
 */
.dashboard-breadcrumbs {
  min-width: 0;
  font-size: 0.8rem;
}

.dashboard-breadcrumbs__list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dashboard-breadcrumbs__item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
}

.dashboard-breadcrumbs__link {
  color: $primary;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.dashboard-breadcrumbs__current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.dashboard-breadcrumbs__separator {
  color: var(--text-muted);
}
</style>
