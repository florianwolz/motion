import type { EngineHandle } from "./engine.js";

const DEFAULT_BRAND_PACKAGE_URL = new URL(
  "../../../../templates/brands/example-brand/example-brand.motionbrand.json",
  import.meta.url,
);

export async function loadDefaultBrandPackage(engine: EngineHandle): Promise<boolean> {
  try {
    const response = await fetch(DEFAULT_BRAND_PACKAGE_URL);
    if (!response.ok) return false;

    engine.loadBrandPackage(await response.text());
    return true;
  } catch {
    return false;
  }
}
