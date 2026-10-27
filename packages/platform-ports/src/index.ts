import type { MediaAsset, ProjectManifestV2 } from "@ai-video/project-core";

export interface ExportArtifacts {
  videoRelativePath: string;
  coverRelativePath: string;
}

export interface MoneyEstimate {
  modelId: string;
  durationSec: number;
  microsUsd: number;
  asOf: string;
}

export type ProviderId = "hedra" | "runway" | "deepseek";
export interface ProviderKeyStatus { provider: ProviderId; configured: boolean }

export interface PlatformPorts {
  projects: {
    create(root: string, title: string): Promise<ProjectManifestV2>;
    open(root: string): Promise<ProjectManifestV2>;
    save(root: string, manifest: ProjectManifestV2): Promise<void>;
    chooseParent(): Promise<string | null>;
    chooseExisting(): Promise<string | null>;
  };
  media: {
    chooseFiles(): Promise<string[]>;
    import(root: string, source: string): Promise<MediaAsset>;
    audit(root: string, assets: MediaAsset[]): Promise<MediaAsset[]>;
    read(root: string, assetId: string): Promise<ArrayBuffer>;
  };
  export: {
    render(root: string, outputName: string): Promise<ExportArtifacts>;
    openFolder(root: string): Promise<void>;
  };
  ai: {
    quote(modelId: string, durationSec: number): Promise<MoneyEstimate>;
    checkBudget(root: string, shotId: string): Promise<MoneyEstimate>;
    keyStatus(): Promise<ProviderKeyStatus[]>;
    setKey(provider: ProviderId, key: string): Promise<void>;
    removeKey(provider: ProviderId): Promise<void>;
  };
}
