// Values from quasar.config.ts > build > defineEnv. Quasar infers their types; declare any that
// need narrowing here.
interface ImportMetaEnv {
  readonly APP_VERSION: string;
}
