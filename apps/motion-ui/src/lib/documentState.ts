const LEGACY_UUID_INDEX = 0;
const SUPPORTED_SCHEMA_VERSIONS = new Set(["0.1.0"]);

function safeParseJson<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function parseUuid(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const known = candidate.Uuid ?? candidate.uuid ?? candidate[LEGACY_UUID_INDEX];
  return typeof known === "string" ? known : null;
}

function collectNodeIds(nodes: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  Object.values(nodes).forEach((rawNode) => {
    if (!rawNode || typeof rawNode !== "object") return;
    const id = parseUuid((rawNode as Record<string, unknown>).id);
    if (id) ids.add(id);
  });
  return ids;
}

export function isSupportedSavedDocument(json: string): boolean {
  const parsed = safeParseJson<Record<string, unknown>>(json);
  if (!parsed) return false;

  const metadata = parsed.metadata as Record<string, unknown> | undefined;
  if (metadata && typeof metadata.schema_version === "string") {
    const schemaVersion = metadata.schema_version;
    if (!SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) return false;
  }

  const scenes = parsed.scenes;
  const nodes = parsed.nodes;
  if (!Array.isArray(scenes) || scenes.length === 0 || !nodes || typeof nodes !== "object") {
    return false;
  }

  const nodeIds = collectNodeIds(nodes as Record<string, unknown>);
  if (nodeIds.size === 0) return false;

  return scenes.every((rawScene) => {
    if (!rawScene || typeof rawScene !== "object") return false;
    const root = parseUuid((rawScene as { root?: unknown }).root);
    return typeof root === "string" && nodeIds.has(root);
  });
}
