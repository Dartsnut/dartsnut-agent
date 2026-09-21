//! API format selection for custom provider endpoints.
//!
//! Expands beyond hardcoded OpenAI Responses to support multiple API formats
//! including chat completions, Anthropic, and Gemini native protocols.

use std::str::FromStr;

/// API format variants supported by custom provider configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiFormat {
    /// Automatically select format (currently resolves to Responses).
    Auto,
    /// OpenAI Responses API format.
    Responses,
    /// OpenAI Chat Completions API format.
    ChatCompletion,
    /// Anthropic Claude native format.
    Claude,
    /// Google Gemini native format.
    Gemini,
}

impl Default for ApiFormat {
    fn default() -> Self {
        ApiFormat::Auto
    }
}

impl FromStr for ApiFormat {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "auto" => Ok(ApiFormat::Auto),
            "responses" => Ok(ApiFormat::Responses),
            "chat_completion" => Ok(ApiFormat::ChatCompletion),
            "claude" => Ok(ApiFormat::Claude),
            "gemini" => Ok(ApiFormat::Gemini),
            _ => Err(format!("Unknown API format: {}", s)),
        }
    }
}

impl ApiFormat {
    /// Resolve Auto to a concrete format. Currently defaults to Responses.
    pub fn resolve(self) -> Self {
        match self {
            ApiFormat::Auto => ApiFormat::Responses,
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_formats() {
        assert_eq!("auto".parse::<ApiFormat>().unwrap(), ApiFormat::Auto);
        assert_eq!("responses".parse::<ApiFormat>().unwrap(), ApiFormat::Responses);
        assert_eq!("chat_completion".parse::<ApiFormat>().unwrap(), ApiFormat::ChatCompletion);
        assert_eq!("claude".parse::<ApiFormat>().unwrap(), ApiFormat::Claude);
        assert_eq!("gemini".parse::<ApiFormat>().unwrap(), ApiFormat::Gemini);
    }

    #[test]
    fn parse_invalid_format() {
        assert!("unknown".parse::<ApiFormat>().is_err());
    }

    #[test]
    fn auto_resolves_to_responses() {
        assert_eq!(ApiFormat::Auto.resolve(), ApiFormat::Responses);
    }

    #[test]
    fn other_formats_resolve_to_self() {
        assert_eq!(ApiFormat::Responses.resolve(), ApiFormat::Responses);
        assert_eq!(ApiFormat::ChatCompletion.resolve(), ApiFormat::ChatCompletion);
        assert_eq!(ApiFormat::Claude.resolve(), ApiFormat::Claude);
        assert_eq!(ApiFormat::Gemini.resolve(), ApiFormat::Gemini);
    }
}
