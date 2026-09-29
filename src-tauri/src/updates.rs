use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateKind {
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    NotAvailable,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub kind: UpdateKind,
    pub current_version: String,
    pub available_version: Option<String>,
    pub percent: Option<u8>,
    pub message: Option<String>,
}

impl UpdateState {
    pub fn idle(version: impl Into<String>) -> Self {
        Self {
            kind: UpdateKind::Idle,
            current_version: version.into(),
            available_version: None,
            percent: None,
            message: None,
        }
    }
    pub fn download_failed(&mut self, message: impl Into<String>) {
        self.kind = UpdateKind::Available;
        self.percent = Some(0);
        self.message = Some(message.into());
    }
    pub fn error(version: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            kind: UpdateKind::Error,
            current_version: version.into(),
            available_version: None,
            percent: None,
            message: Some(message.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn state_serializes_for_renderer_contract() {
        let state = UpdateState {
            kind: UpdateKind::Available,
            current_version: "1.0.0".into(),
            available_version: Some("1.1.0".into()),
            percent: None,
            message: None,
        };
        let json = serde_json::to_value(state).unwrap();
        assert_eq!(json["kind"], "available");
        assert_eq!(json["currentVersion"], "1.0.0");
    }

    #[test]
    fn error_state_exposes_the_failure_and_clears_stale_update_data() {
        let state = UpdateState::error("1.0.0", "updater unavailable");
        let json = serde_json::to_value(state).unwrap();

        assert_eq!(json["kind"], "error");
        assert_eq!(json["currentVersion"], "1.0.0");
        assert_eq!(json["availableVersion"], serde_json::Value::Null);
        assert_eq!(json["percent"], serde_json::Value::Null);
        assert_eq!(json["message"], "updater unavailable");
    }

    #[test]
    fn failed_download_returns_to_available_without_losing_version() {
        let mut state = UpdateState {
            kind: UpdateKind::Downloading,
            current_version: "1.0.0".into(),
            available_version: Some("1.1.0".into()),
            percent: Some(42),
            message: Some("Downloading update...".into()),
        };

        state.download_failed("Update download failed. Try again.");

        assert_eq!(state.kind, UpdateKind::Available);
        assert_eq!(state.current_version, "1.0.0");
        assert_eq!(state.available_version.as_deref(), Some("1.1.0"));
        assert_eq!(state.percent, Some(0));
        assert_eq!(state.message.as_deref(), Some("Update download failed. Try again."));
    }
}
