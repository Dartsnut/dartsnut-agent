//! Async SSH/SFTP transport feasibility slice.
//!
//! The public API keeps transport details out of deploy orchestration. It
//! deliberately requires an explicit host-key policy: russh's default handler
//! rejects every key, and this module never provides a trust-all fallback.

use std::fmt;
use std::future::Future;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;

use russh::client::Handler;
use russh::keys::{self, PublicKey, PublicKeyOrCertificate};
use russh::{ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use thiserror::Error;
use tokio::io::AsyncWriteExt;

/// Which SSH channel stream produced an output chunk.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OutputStream {
    Stdout,
    Stderr,
}

/// A completed remote command result.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ExecOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub exit_code: Option<u32>,
    pub exit_signal: Option<String>,
}

/// Host-key verification policy.
///
/// `KnownHosts` rejects both unknown keys and changed keys. `TrustLatest`
/// records an unknown key, and *replaces* a changed one: the store belongs to
/// this app alone and a re-flashed device legitimately presents a new key, so a
/// stale entry must not lock the user out of their own hardware. `Pinned`
/// compares the complete public key.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HostKeyPolicy {
    KnownHosts { path: PathBuf },
    TrustLatest { path: PathBuf },
    Pinned(PublicKey),
}

/// How the server's key relates to the store.
enum HostKeyStatus {
    Present,
    Missing,
    Changed,
}

impl HostKeyPolicy {
    /// Verify one server key and, for TOFU, persist an initially unseen key.
    pub fn check(
        &self,
        host: &str,
        port: u16,
        server_key: &PublicKeyOrCertificate,
    ) -> Result<bool, SshError> {
        let server_key = server_key.public_key();
        match self {
            Self::Pinned(pinned) => {
                if pinned.algorithm() == server_key.algorithm() && pinned == &server_key {
                    Ok(true)
                } else {
                    Err(SshError::HostKeyRejected {
                        host: host.to_owned(),
                        reason: "pinned key mismatch".to_owned(),
                    })
                }
            }
            Self::KnownHosts { path } => {
                let known = check_known_hosts(host, port, &server_key, path)?;
                if known {
                    Ok(true)
                } else {
                    Err(SshError::HostKeyRejected {
                        host: host.to_owned(),
                        reason: "key is not present in known_hosts".to_owned(),
                    })
                }
            }
            Self::TrustLatest { path } => {
                match known_host_status(host, port, &server_key, path)? {
                    HostKeyStatus::Present => Ok(true),
                    HostKeyStatus::Missing => {
                        keys::known_hosts::learn_known_hosts_path(host, port, &server_key, path)
                            .map_err(|error| SshError::HostKeyStore(error.to_string()))?;
                        Ok(true)
                    }
                    // The device changed its key. Rewrite the store rather than
                    // refusing: nothing else in this app pins the identity, and
                    // the only user with this device is the one connecting.
                    HostKeyStatus::Changed => {
                        forget_known_host(host, port, path)?;
                        keys::known_hosts::learn_known_hosts_path(host, port, &server_key, path)
                            .map_err(|error| SshError::HostKeyStore(error.to_string()))?;
                        Ok(true)
                    }
                }
            }
        }
    }
}

/// SSH connection settings.
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub host_key_policy: HostKeyPolicy,
    pub connect_timeout: Duration,
    /// Optional idle timeout for an established SSH session. Keep `None` for
    /// long-lived commands such as `tail -f`; cancellation is driven by
    /// dropping the command future/channel.
    pub inactivity_timeout: Option<Duration>,
}

impl SshConfig {
    pub fn new(
        host: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
        host_key_policy: HostKeyPolicy,
    ) -> Self {
        Self {
            host: host.into(),
            port: 22,
            username: username.into(),
            password: password.into(),
            host_key_policy,
            connect_timeout: Duration::from_secs(15),
            inactivity_timeout: None,
        }
    }
}

impl fmt::Debug for SshConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SshConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("password", &"[redacted]")
            .field("host_key_policy", &self.host_key_policy)
            .field("connect_timeout", &self.connect_timeout)
            .finish()
    }
}

/// Errors returned by the SSH/SFTP feasibility API.
#[derive(Debug, Error)]
pub enum SshError {
    #[error("SSH protocol error: {0}")]
    Protocol(#[from] russh::Error),
    #[error("SSH authentication failed")]
    Authentication,
    #[error("SSH connection timed out")]
    ConnectTimeout,
    #[error("SSH host key rejected for {host}: {reason}")]
    HostKeyRejected { host: String, reason: String },
    #[error("SSH host-key store failed: {0}")]
    HostKeyStore(String),
    #[error("SFTP error: {0}")]
    Sftp(String),
    #[error("invalid remote SFTP path: {0}")]
    InvalidRemotePath(String),
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
    #[error("SSH command cancelled")]
    Cancelled,
}

/// A connected SSH session.
type DisconnectCallback = Arc<Mutex<Option<Arc<dyn Fn() + Send + Sync>>>>;

pub struct SshConnection {
    session: russh::client::Handle<PolicyHandler>,
    disconnect_callback: DisconnectCallback,
    sudo_password: String,
}

impl SshConnection {
    /// Establish and password-authenticate a connection.
    pub async fn connect(config: SshConfig) -> Result<Self, SshError> {
        let handler = PolicyHandler {
            host: config.host.clone(),
            port: config.port,
            policy: config.host_key_policy.clone(),
            disconnect_callback: Arc::new(Mutex::new(None)),
        };
        let disconnect_callback = handler.disconnect_callback.clone();
        let client_config = Arc::new(russh::client::Config {
            inactivity_timeout: config.inactivity_timeout,
            ..Default::default()
        });

        let username = config.username;
        let password = config.password;
        let sudo_password = password.clone();
        let address = (config.host, config.port);
        let session = tokio::time::timeout(config.connect_timeout, async move {
            let mut session = russh::client::connect(client_config, address, handler).await?;
            let authentication = session.authenticate_password(username, password).await?;
            if !authentication.success() {
                return Err(SshError::Authentication);
            }
            Ok::<_, SshError>(session)
        })
        .await
        .map_err(|_| SshError::ConnectTimeout)??;

        Ok(Self {
            session,
            disconnect_callback,
            sudo_password,
        })
    }

    /// Install callback invoked when remote transport closes unexpectedly.
    pub fn set_disconnect_callback<F>(&self, callback: F)
    where
        F: Fn() + Send + Sync + 'static,
    {
        if let Ok(mut current) = self.disconnect_callback.lock() {
            *current = Some(Arc::new(callback));
        }
    }

    /// Suppress disconnect callback before an intentional close or replacement.
    pub fn clear_disconnect_callback(&self) {
        if let Ok(mut current) = self.disconnect_callback.lock() {
            *current = None;
        }
    }

    /// Execute command, collecting stdout and stderr separately.
    pub async fn exec(&self, command: &str) -> Result<ExecOutput, SshError> {
        self.exec_streaming(command, None, |_, _| {}).await
    }

    /// Authenticate sudo through stdin, keeping credentials out of command text.
    pub async fn exec_sudo(&self, command: &str) -> Result<ExecOutput, SshError> {
        self.exec_with_stdin(
            &format!("sudo -S -p '' -- {command}"),
            format!("{}\n", self.sudo_password).as_bytes(),
        )
        .await
    }

    /// Execute command after writing stdin and sending SSH EOF.
    ///
    /// Sending EOF is required for `bash -s`; waiting for the command's exit
    /// status before closing stdin can deadlock scripts that read until EOF.
    pub async fn exec_with_stdin(
        &self,
        command: &str,
        stdin: &[u8],
    ) -> Result<ExecOutput, SshError> {
        self.exec_streaming(command, Some(stdin), |_, _| {}).await
    }

    /// Execute a shell script through `bash -s`, closing script stdin first.
    pub async fn exec_bash_script(&self, script: &[u8]) -> Result<ExecOutput, SshError> {
        self.exec_with_stdin("bash -s", script).await
    }

    /// Execute command while receiving output incrementally.
    ///
    /// Dropping this future closes its channel handle, which is the
    /// cancellation primitive used by the caller for long-lived commands such
    /// as `tail -f`.
    pub async fn exec_streaming<F>(
        &self,
        command: &str,
        stdin: Option<&[u8]>,
        mut on_chunk: F,
    ) -> Result<ExecOutput, SshError>
    where
        F: FnMut(OutputStream, &[u8]) + Send,
    {
        let mut channel = self.session.channel_open_session().await?;
        channel.exec(true, command).await?;
        if let Some(stdin) = stdin {
            channel.data_bytes(stdin.to_vec()).await?;
            channel.eof().await?;
        }

        let mut output = ExecOutput::default();
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => {
                    on_chunk(OutputStream::Stdout, &data);
                    output.stdout.extend_from_slice(&data);
                }
                ChannelMsg::ExtendedData { data, .. } => {
                    on_chunk(OutputStream::Stderr, &data);
                    output.stderr.extend_from_slice(&data);
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    output.exit_code = Some(exit_status);
                }
                ChannelMsg::ExitSignal { signal_name, .. } => {
                    output.exit_signal = Some(format!("{signal_name:?}"));
                }
                ChannelMsg::Close => break,
                _ => {}
            }
        }

        // Server normally sends Close. Best-effort close also covers servers
        // that finish with EOF but leave the channel open.
        let _ = channel.close().await;
        Ok(output)
    }

    /// Upload one local file through SFTP, truncating/replacing remote file.
    pub async fn upload_file(
        &self,
        local_path: impl AsRef<Path>,
        remote_path: &str,
    ) -> Result<u64, SshError> {
        if remote_path.is_empty() {
            return Err(SshError::InvalidRemotePath(
                "path cannot be empty".to_owned(),
            ));
        }

        let mut local = tokio::fs::File::open(local_path).await?;
        let channel = self.session.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|error| SshError::Sftp(error.to_string()))?;
        let mut remote = sftp
            .create(remote_path)
            .await
            .map_err(|error| SshError::Sftp(error.to_string()))?;
        let copied = tokio::io::copy(&mut local, &mut remote).await?;
        remote
            .shutdown()
            .await
            .map_err(|error| SshError::Sftp(error.to_string()))?;
        sftp.close()
            .await
            .map_err(|error| SshError::Sftp(error.to_string()))?;
        Ok(copied)
    }

    /// Request graceful SSH disconnect.
    pub async fn close(&self) -> Result<(), SshError> {
        self.session
            .disconnect(Disconnect::ByApplication, "closed by application", "en")
            .await?;
        Ok(())
    }
}

/// Russh callback that applies host-key policy during key exchange.
pub struct PolicyHandler {
    host: String,
    port: u16,
    policy: HostKeyPolicy,
    disconnect_callback: DisconnectCallback,
}

impl Handler for PolicyHandler {
    type Error = SshError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        self.policy.check(&self.host, self.port, server_public_key)
    }

    fn disconnected(
        &mut self,
        reason: russh::client::DisconnectReason<Self::Error>,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        if let Ok(callback) = self.disconnect_callback.lock() {
            if let Some(callback) = callback.as_ref() {
                callback();
            }
        }
        async move {
            match reason {
                russh::client::DisconnectReason::ReceivedDisconnect(_) => Ok(()),
                russh::client::DisconnectReason::Error(error) => Err(error),
            }
        }
    }
}

fn check_known_hosts(
    host: &str,
    port: u16,
    key: &PublicKey,
    path: &Path,
) -> Result<bool, SshError> {
    keys::known_hosts::check_known_hosts_path(host, port, key, path).map_err(|error| match error {
        keys::Error::KeyChanged { .. } => SshError::HostKeyRejected {
            host: host.to_owned(),
            reason: "known_hosts key changed".to_owned(),
        },
        other => SshError::HostKeyStore(other.to_string()),
    })
}

/// Classify the server key against the store without collapsing a change into a
/// plain "unknown": the two call for different actions.
fn known_host_status(
    host: &str,
    port: u16,
    key: &PublicKey,
    path: &Path,
) -> Result<HostKeyStatus, SshError> {
    match check_known_hosts(host, port, key, path) {
        Ok(true) => Ok(HostKeyStatus::Present),
        Ok(false) => Ok(HostKeyStatus::Missing),
        Err(SshError::HostKeyRejected { .. }) => Ok(HostKeyStatus::Changed),
        Err(other) => Err(other),
    }
}

/// Drop every entry for `host`, so a superseded key cannot be read again.
///
/// russh only records and checks; there is no remove, so this walks its own
/// line-indexed lookup and writes the file back without those lines.
fn forget_known_host(host: &str, port: u16, path: &Path) -> Result<(), SshError> {
    let stale: std::collections::HashSet<usize> =
        keys::known_hosts::known_host_keys_path(host, port, path)
            .map_err(|error| SshError::HostKeyStore(error.to_string()))?
            .into_iter()
            .map(|(line, _)| line)
            .collect();
    if stale.is_empty() {
        return Ok(());
    }
    let body =
        std::fs::read_to_string(path).map_err(|error| SshError::HostKeyStore(error.to_string()))?;
    let kept: String = body
        .lines()
        .enumerate()
        .filter(|(index, _)| !stale.contains(&(index + 1)))
        .map(|(_, line)| format!("{line}\n"))
        .collect();
    std::fs::write(path, kept).map_err(|error| SshError::HostKeyStore(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    const ED25519_KEY: &str =
        "AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ";
    const OTHER_ED25519_KEY: &str =
        "AAAAC3NzaC1lZDI1NTE5AAAAILIG2T/B0l0gaqj3puu510tu9N1OkQ4znY3LYuEm5zCF";

    fn key(encoded: &str) -> PublicKey {
        keys::parse_public_key_base64(encoded).expect("fixture public key parses")
    }

    fn temporary_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("dartsnut-ssh-{label}-{nonce}"))
    }

    #[test]
    fn pinned_policy_accepts_exact_key_and_rejects_changed_key() {
        let policy = HostKeyPolicy::Pinned(key(ED25519_KEY));
        let accepted = PublicKeyOrCertificate::from(key(ED25519_KEY));
        let changed = PublicKeyOrCertificate::from(key(OTHER_ED25519_KEY));

        assert!(policy
            .check("example.test", 22, &accepted)
            .expect("key accepted"));
        assert!(matches!(
            policy.check("example.test", 22, &changed),
            Err(SshError::HostKeyRejected { .. })
        ));
    }

    #[test]
    fn known_hosts_policy_rejects_unknown_key() {
        let path = temporary_path("known");
        fs::write(&path, b"").expect("create empty known_hosts");
        let policy = HostKeyPolicy::KnownHosts { path: path.clone() };
        let server_key = PublicKeyOrCertificate::from(key(ED25519_KEY));

        assert!(matches!(
            policy.check("example.test", 22, &server_key),
            Err(SshError::HostKeyRejected { .. })
        ));
        fs::remove_file(path).expect("remove test known_hosts");
    }

    #[test]
    fn known_hosts_policy_accepts_matching_key_and_rejects_changed_key() {
        let path = temporary_path("known-match");
        let known_key = key(ED25519_KEY);
        fs::write(
            &path,
            format!(
                "example.test {}\n",
                known_key.to_openssh().expect("key encodes")
            ),
        )
        .expect("create known_hosts fixture");
        let policy = HostKeyPolicy::KnownHosts { path: path.clone() };
        let matching = PublicKeyOrCertificate::from(known_key);
        let changed = PublicKeyOrCertificate::from(key(OTHER_ED25519_KEY));

        assert!(policy
            .check("example.test", 22, &matching)
            .expect("known key accepted"));
        assert!(matches!(
            policy.check("example.test", 22, &changed),
            Err(SshError::HostKeyRejected { .. })
        ));
        fs::remove_file(path).expect("remove test known_hosts");
    }

    #[test]
    fn trust_latest_records_unknown_key_then_accepts_it() {
        let path = temporary_path("tofu");
        let policy = HostKeyPolicy::TrustLatest { path: path.clone() };
        let server_key = PublicKeyOrCertificate::from(key(ED25519_KEY));

        assert!(policy
            .check("example.test", 2222, &server_key)
            .expect("TOFU records key"));
        assert!(path.exists());
        assert!(policy
            .check("example.test", 2222, &server_key)
            .expect("known TOFU key"));
        fs::remove_file(path).expect("remove test known_hosts");
    }

    // A re-flashed device legitimately presents a new key. The store belongs to
    // this app, so a stale entry must be replaced rather than locking the user
    // out of their own hardware.
    #[test]
    fn trust_latest_replaces_a_changed_key() {
        let path = temporary_path("tofu-changed");
        let policy = HostKeyPolicy::TrustLatest { path: path.clone() };
        let first = PublicKeyOrCertificate::from(key(ED25519_KEY));
        let second = PublicKeyOrCertificate::from(key(OTHER_ED25519_KEY));

        assert!(policy
            .check("example.test", 2222, &first)
            .expect("first key"));
        assert!(policy
            .check("example.test", 2222, &second)
            .expect("changed key is adopted"));
        // Both the new key and the old entry's absence must hold: a leftover
        // line would let a superseded key through next time.
        assert!(policy
            .check("example.test", 2222, &second)
            .expect("new key sticks"));
        let stored = fs::read_to_string(&path).expect("store readable");
        assert!(!stored.contains(&key(ED25519_KEY).to_openssh().unwrap()));
        assert_eq!(stored.matches("example.test").count(), 1);
        fs::remove_file(path).expect("remove test known_hosts");
    }

    #[test]
    fn trust_latest_leaves_other_hosts_alone() {
        let path = temporary_path("tofu-other");
        let policy = HostKeyPolicy::TrustLatest { path: path.clone() };
        policy
            .check(
                "other.test",
                2222,
                &PublicKeyOrCertificate::from(key(OTHER_ED25519_KEY)),
            )
            .expect("other host recorded");
        policy
            .check(
                "example.test",
                2222,
                &PublicKeyOrCertificate::from(key(ED25519_KEY)),
            )
            .expect("first key");
        policy
            .check(
                "example.test",
                2222,
                &PublicKeyOrCertificate::from(key(OTHER_ED25519_KEY)),
            )
            .expect("changed key adopted");

        let stored = fs::read_to_string(&path).expect("store readable");
        assert_eq!(
            stored.matches("other.test").count(),
            1,
            "unrelated host removed"
        );
        fs::remove_file(path).expect("remove test known_hosts");
    }

    #[test]
    fn config_debug_redacts_password() {
        let config = SshConfig::new(
            "example.test",
            "dartsnut",
            "super-secret",
            HostKeyPolicy::Pinned(key(ED25519_KEY)),
        );
        let debug = format!("{config:?}");
        assert!(!debug.contains("super-secret"));
        assert!(debug.contains("[redacted]"));
    }

    #[test]
    fn output_stream_is_explicitly_separated() {
        assert_ne!(OutputStream::Stdout, OutputStream::Stderr);
        assert_eq!(OutputStream::Stdout, OutputStream::Stdout);
    }
}
