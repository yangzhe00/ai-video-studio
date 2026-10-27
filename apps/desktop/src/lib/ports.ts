import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import type { PlatformPorts } from "@ai-video/platform-ports";
import {
  auditAssets, checkShotBudget, createProject, exportProject, importAsset, openProject,
  providerKeyStatus, quoteShot, readAsset, removeProviderKey, saveProject, setProviderKey,
} from "./native";

const chooseDirectory = async (title: string): Promise<string | null> => {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
};

export const desktopPorts: PlatformPorts = {
  projects: {
    create: createProject,
    open: openProject,
    save: saveProject,
    chooseParent: () => chooseDirectory("选择项目保存位置"),
    chooseExisting: () => chooseDirectory("选择项目文件夹"),
  },
  media: {
    async chooseFiles() {
      const selected = await open({ multiple: true, directory: false, title: "选择照片、视频或音频" });
      return selected ? Array.isArray(selected) ? selected : [selected] : [];
    },
    import: importAsset,
    audit: auditAssets,
    read: readAsset,
  },
  export: {
    render: exportProject,
    openFolder: async root => { await openPath(`${root}/exports`); },
  },
  ai: {
    quote: quoteShot,
    checkBudget: checkShotBudget,
    keyStatus: providerKeyStatus,
    setKey: setProviderKey,
    removeKey: removeProviderKey,
  },
};
