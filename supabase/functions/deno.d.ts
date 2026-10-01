/**
 * Ambient declarations that let the app's `tsc` check the edge functions.
 *
 * The functions run under Deno, but three of their modules (`risk.ts`,
 * `crisis-resources.ts`, `taxonomy.ts`) are imported by the app as well, so the risk
 * taxonomy, the crisis resources and the neurotype list have exactly one definition.
 * That puts this directory inside the app's tsconfig, where neither the `Deno` global
 * nor a `jsr:` specifier resolves on its own.
 *
 * Nothing here is a polyfill or a stand-in. The Deno block describes only the three
 * runtime APIs these files call, and the module block points the `jsr:` specifier at
 * the same library's npm types — jsr `@supabase/supabase-js@2` and npm
 * `@supabase/supabase-js@2` are the same package. Deno supplies the real definitions
 * for both when the functions are checked or served with the Supabase CLI.
 */

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  test(name: string, fn: () => void | Promise<void>): void;
  test(definition: { name: string; fn: () => void | Promise<void> }): void;
};

declare module 'jsr:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}
