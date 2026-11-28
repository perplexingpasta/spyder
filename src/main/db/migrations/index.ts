// Bundled migrations (Vite `?raw` import). Scripts run under tsx use loadMigrationsFromDisk() instead.
import init from './001_init.sql?raw';
import scopeReset from './002_scope_reset.sql?raw';
import blocks from './003_blocks.sql?raw';
import tags from './004_tags.sql?raw';
import efficiency from './005_efficiency.sql?raw';
import merges from './006_merges.sql?raw';
import reflections from './007_reflections.sql?raw';
import appPaths from './008_app_paths.sql?raw';
import sleepTag from './009_sleep_tag.sql?raw';
import sleepBeige from './010_sleep_beige.sql?raw';
import gadget from './011_gadget.sql?raw';
import type { Migration } from '../migrate';

export const MIGRATIONS: Migration[] = [
  { version: 1, sql: init },
  { version: 2, sql: scopeReset },
  { version: 3, sql: blocks },
  { version: 4, sql: tags },
  { version: 5, sql: efficiency },
  { version: 6, sql: merges },
  { version: 7, sql: reflections },
  { version: 8, sql: appPaths },
  { version: 9, sql: sleepTag },
  { version: 10, sql: sleepBeige },
  { version: 11, sql: gadget },
];
