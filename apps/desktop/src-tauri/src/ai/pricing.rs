use super::types::{GenerationJob, JobState};
use crate::project::{open_project_impl, ProjectManifestV2};
use serde::Serialize;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoneyEstimate {
    pub model_id: String,
    pub duration_sec: u8,
    pub micros_usd: u64,
    pub as_of: &'static str,
}

pub fn estimate_usd(model_id: &str, duration_sec: u8) -> Result<MoneyEstimate, String> {
    if !(4..=12).contains(&duration_sec) { return Err("模型时长必须为 4 到 12 秒".into()); }
    let micros_per_second: u64 = match model_id {
        "seedance-15-pro" => 25_000, // 720p without audio
        "kling-ai-avatar-v2-standard" => 56_200, // 720p
        "gen4_turbo" => 50_000, // Runway: 5 credits/sec at $0.01/credit
        _ => return Err("模型没有已核对的费用基线".into()),
    };
    Ok(MoneyEstimate { model_id: model_id.into(), duration_sec, micros_usd: micros_per_second * u64::from(duration_sec), as_of: "2026-10-27" })
}

fn usd_to_micros(value: f64) -> Result<u64, String> {
    if !value.is_finite() || value < 0.0 || value > 1_000_000.0 { return Err("项目预算金额无效".into()); }
    Ok((value * 1_000_000.0).round() as u64)
}

fn reserved_usd_micros(job: &GenerationJob) -> Result<u64, String> {
    if let Some(actual) = job.actual_usd { return usd_to_micros(actual); }
    match job.state {
        JobState::Draft | JobState::Failed => Ok(0),
        JobState::Submitting | JobState::Queued | JobState::Running | JobState::Succeeded | JobState::Unknown => usd_to_micros(job.estimated_usd),
    }
}

pub fn reserve_budget(project: &ProjectManifestV2, mut job: GenerationJob, estimate: &MoneyEstimate) -> Result<ProjectManifestV2, String> {
    let limit = usd_to_micros(project.budget_usd.ok_or("请先设置项目预算上限")?)?;
    if project.jobs.iter().any(|existing| existing.id == job.id) { return Err("任务 ID 已存在，不能重复提交".into()); }
    if !project.shots.iter().any(|shot| shot.id == job.shot_id) { return Err("镜头不存在".into()); }
    if job.model_id != estimate.model_id || usd_to_micros(job.estimated_usd)? != estimate.micros_usd {
        return Err("任务估价已变化，需要重新确认".into());
    }
    let used = project.jobs.iter().try_fold(0u64, |sum, existing| {
        sum.checked_add(reserved_usd_micros(existing)?).ok_or("费用总额溢出".to_string())
    })?;
    if used.checked_add(estimate.micros_usd).is_none_or(|total| total > limit) { return Err("项目预算不足，不能提交付费任务".into()); }
    job.state = JobState::Submitting;
    let mut updated = project.clone();
    updated.jobs.push(job);
    Ok(updated)
}

#[tauri::command]
pub fn quote_shot(model_id: String, duration_sec: u8) -> Result<MoneyEstimate, String> {
    estimate_usd(&model_id, duration_sec)
}

#[tauri::command]
pub fn check_shot_budget(root: PathBuf, shot_id: String) -> Result<MoneyEstimate, String> {
    let project = open_project_impl(&root)?;
    let shot = project.shots.iter().find(|shot| shot.id == shot_id).ok_or("镜头不存在")?;
    let estimate = estimate_usd(&shot.model_id, shot.duration_sec)?;
    let job = GenerationJob {
        id: Uuid::new_v4().to_string(), shot_id: shot_id.clone(), provider: if shot.model_id == "gen4_turbo" { "runway" } else { "hedra" }.into(),
        model_id: shot.model_id.clone(), state: JobState::Draft, remote_id: None,
        estimated_usd: estimate.micros_usd as f64 / 1_000_000.0, actual_usd: None, output_asset_id: None,
    };
    reserve_budget(&project, job, &estimate)?;
    Ok(estimate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::ShotDraft;
    use crate::project::create_project_impl;
    use uuid::Uuid;

    #[test]
    fn pricing_estimates_expected_model_costs() {
        assert_eq!(estimate_usd("seedance-15-pro", 10).unwrap().micros_usd, 250_000);
        assert_eq!(estimate_usd("kling-ai-avatar-v2-standard", 5).unwrap().micros_usd, 281_000);
        assert_eq!(estimate_usd("gen4_turbo", 10).unwrap().micros_usd, 500_000);
    }

    #[test]
    fn pricing_counts_pending_reservations_before_second_submission() {
        let root = std::env::temp_dir().join(format!("ai-video-price-{}", Uuid::new_v4()));
        let mut project = create_project_impl(&root, "费用测试".into()).unwrap();
        project.budget_usd = Some(0.60);
        project.shots.push(ShotDraft { id: "s".into(), source_asset_id: "a".into(), prompt: "跳舞".into(), duration_sec: 10, speaking: false, script: None, accepted_audio_asset_id: None, model_id: "seedance-15-pro".into() });
        let job = |id: &str, model: &str, price: f64| GenerationJob { id: id.into(), shot_id: "s".into(), provider: "hedra".into(), model_id: model.into(), state: JobState::Draft, remote_id: None, estimated_usd: price, actual_usd: None, output_asset_id: None };
        let first = reserve_budget(&project, job("1", "seedance-15-pro", 0.25), &estimate_usd("seedance-15-pro", 10).unwrap()).unwrap();
        let second = reserve_budget(&first, job("2", "kling-ai-avatar-v2-standard", 0.281), &estimate_usd("kling-ai-avatar-v2-standard", 5).unwrap()).unwrap();
        assert_eq!(second.jobs.len(), 2);
        assert!(reserve_budget(&second, job("3", "seedance-15-pro", 0.25), &estimate_usd("seedance-15-pro", 10).unwrap()).unwrap_err().contains("预算不足"));
        assert!(reserve_budget(&project, job("4", "seedance-15-pro", 0.20), &estimate_usd("seedance-15-pro", 10).unwrap()).unwrap_err().contains("重新确认"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
