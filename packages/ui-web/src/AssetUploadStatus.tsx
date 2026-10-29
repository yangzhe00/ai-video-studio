export type AssetUploadState = "pending" | "uploading" | "failed" | "synced";

export interface AssetUploadItem {
  id: string;
  name: string;
  state: AssetUploadState;
  error?: string;
}

interface Props {
  items: AssetUploadItem[];
  onRetry: (assetId: string) => void;
}

const labels: Record<AssetUploadState, string> = {
  pending: "等待上传", uploading: "上传中", failed: "上传失败", synced: "已同步",
};

export function AssetUploadStatus({ items, onRetry }: Props) {
  if (!items.length) return null;
  return <section className="avs-asset-upload-status" aria-label="素材同步状态">
    <strong>素材同步</strong>
    <ul>{items.map(item => <li key={item.id}>
      <span className={`avs-asset-upload-dot avs-asset-upload-dot--${item.state}`} aria-hidden="true" />
      <span className="avs-asset-upload-name" title={item.name}>{item.name}</span>
      <span className="avs-asset-upload-label">{labels[item.state]}</span>
      {item.state === "failed" && <button type="button" onClick={() => onRetry(item.id)} aria-label={`重试上传 ${item.name}`}>重试</button>}
      {item.error && <small role="alert">{item.error}</small>}
    </li>)}</ul>
  </section>;
}
