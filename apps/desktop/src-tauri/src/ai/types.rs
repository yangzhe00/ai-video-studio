use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShotDraft {
    pub id: String,
    pub source_asset_id: String,
    pub prompt: String,
    pub duration_sec: u8,
    pub speaking: bool,
    pub script: Option<String>,
    pub accepted_audio_asset_id: Option<String>,
    pub model_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Draft,
    Submitting,
    Queued,
    Running,
    Succeeded,
    Failed,
    Unknown,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationJob {
    pub id: String,
    pub shot_id: String,
    pub provider: String,
    pub model_id: String,
    pub state: JobState,
    pub remote_id: Option<String>,
    pub estimated_usd: f64,
    pub actual_usd: Option<f64>,
    pub output_asset_id: Option<String>,
}
