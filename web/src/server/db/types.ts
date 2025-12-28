export type ProjectRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type ProjectViewRow = {
  project_id: string;
  world_x: number;
  world_y: number;
  zoom: number;
  updated_at: string;
};

export type ProjectSyncRow = {
  project_id: string;
  canvas_rev: number;
  view_rev: number;
  canvas_updated_at: string;
  view_updated_at: string;
};

export type AssetRow = {
  id: string;
  project_id: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  storage_path: string;
  storage_url: string;
  thumb_path: string | null;
  thumb_url: string | null;
  deleted_at: string | null;
  trashed_storage_path: string | null;
  trashed_thumb_path: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
};

export type AssetAiRow = {
  asset_id: string;
  caption: string | null;
  tags_json: string | null;
  status: "pending" | "processing" | "done" | "failed";
  model_version: string | null;
  updated_at: string;
};

export type AssetEmbeddingRow = {
  asset_id: string;
  model: string;
  dim: number;
  embedding: Buffer | null;
  updated_at: string;
};

export type AssetSegmentRow = {
  asset_id: string;
  tag: string;
  svg: string | null;
  bbox_json: string | null;
  updated_at: string;
};

export type AssetWithAi = AssetRow & {
  ai_caption: string | null;
  ai_tags_json: string | null;
  ai_status: AssetAiRow["status"] | null;
  ai_model_version: string | null;
  ai_updated_at: string | null;
};

export type CanvasObjectRow = {
  id: string;
  project_id: string;
  type: "image" | "text" | "shape" | "group";
  asset_id: string | null;
  x: number;
  y: number;
  scale_x: number;
  scale_y: number;
  rotation: number;
  width: number | null;
  height: number | null;
  z_index: number;
  props_json: string | null;
  created_at: string;
  updated_at: string;
};


