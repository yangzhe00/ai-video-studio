export type Platform = "desktop" | "web" | "mobile";
export type WorkspacePanel = "media" | "timeline" | "captions" | "shot-drafts" | "generation" | "cover" | "publishing" | "export";

export interface FeaturePlugin {
  id: string;
  version: string;
  supportedPlatforms: readonly Platform[];
  requires?: readonly string[];
  contributes: {
    panels: readonly WorkspacePanel[];
    routes?: readonly string[];
    capabilities?: readonly string[];
    nodeTypes?: readonly string[];
  };
}

export class PluginRegistrationError extends Error {}

export function resolvePlugins(
  platform: Platform,
  enabledIds: readonly string[],
  registry: readonly FeaturePlugin[],
): FeaturePlugin[] {
  const byId = new Map<string, FeaturePlugin>();
  for (const plugin of registry) {
    if (byId.has(plugin.id)) throw new PluginRegistrationError(`重复的插件 ID：${plugin.id}`);
    byId.set(plugin.id, plugin);
  }

  const enabled = new Set(enabledIds);
  for (const id of enabled) {
    if (!byId.has(id)) throw new PluginRegistrationError(`未注册的插件：${id}`);
  }

  const available = new Map([...byId].filter(([id, plugin]) => enabled.has(id) && plugin.supportedPlatforms.includes(platform)));
  const ordered: FeaturePlugin[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new PluginRegistrationError(`插件依赖循环：${id}`);
    const plugin = available.get(id);
    if (!plugin) throw new PluginRegistrationError(`插件 ${id} 不支持 ${platform} 或未启用`);
    visiting.add(id);
    for (const dependency of plugin.requires ?? []) {
      if (!available.has(dependency)) throw new PluginRegistrationError(`插件 ${id} 缺少依赖：${dependency}`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
    ordered.push(plugin);
  }

  for (const id of enabledIds) {
    if (available.has(id)) visit(id);
  }
  return ordered;
}
