import type { ParamValue, Practice, ProfileId } from "./types.ts";

/** The params the catalogue gives a practice for one profile (empty when it gives none). */
export function paramsFor(p: Practice, profile: ProfileId): Record<string, ParamValue> {
  return p.profile_rules?.[profile]?.params ?? {};
}

/** Replaces {name} placeholders in anchors and fix hints with the active profile's values. Unknown names are left as written. */
export function render(template: string, params: Record<string, ParamValue>): string {
  return template.replace(/\{([a-z_]+)\}/g, (m, key: string) => {
    const v = params[key];
    return v === undefined ? m : Array.isArray(v) ? v.join(", ") : String(v);
  });
}
