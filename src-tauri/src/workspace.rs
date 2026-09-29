use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("workspace path does not exist: {0}")]
    Missing(PathBuf),
    #[error("workspace path is not a directory: {0}")]
    NotDirectory(PathBuf),
    #[error("path escapes workspace root")]
    Escape,
    #[error("workspace I/O error: {0}")]
    Io(#[from] io::Error),
}

#[derive(Clone, Debug)]
pub struct WorkspaceRoot(PathBuf);

impl WorkspaceRoot {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, WorkspaceError> {
        let path = path.as_ref();
        if !path.exists() {
            return Err(WorkspaceError::Missing(path.to_path_buf()));
        }
        if !path.is_dir() {
            return Err(WorkspaceError::NotDirectory(path.to_path_buf()));
        }
        Ok(Self(std::fs::canonicalize(path)?))
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    pub fn resolve(&self, relative: impl AsRef<Path>) -> Result<PathBuf, WorkspaceError> {
        let relative = relative.as_ref();
        if relative.is_absolute() {
            return Err(WorkspaceError::Escape);
        }
        let candidate = self.0.join(relative);
        let parent = candidate.parent().unwrap_or(self.0.as_path());
        let canonical_parent =
            std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
        if !canonical_parent.starts_with(&self.0) {
            return Err(WorkspaceError::Escape);
        }
        if candidate.exists() {
            let canonical = std::fs::canonicalize(&candidate)?;
            if !canonical.starts_with(&self.0) {
                return Err(WorkspaceError::Escape);
            }
            return Ok(canonical);
        }
        Ok(candidate)
    }
}

/// Identity of the files that decide emulator/deploy eligibility.
/// `None` hashes mean the file is missing or unreadable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceManifestSig {
    pub root: Option<PathBuf>,
    pub pyproject: Option<u64>,
    pub conf: Option<u64>,
}

pub fn manifest_sig(root: Option<&Path>) -> WorkspaceManifestSig {
    WorkspaceManifestSig {
        root: root.map(Path::to_path_buf),
        pyproject: root.and_then(|path| content_sig(&path.join("pyproject.toml"))),
        conf: root.and_then(|path| content_sig(&path.join("conf.json"))),
    }
}

fn content_sig(path: &Path) -> Option<u64> {
    let bytes = std::fs::read(path).ok()?;
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    Some(hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn rejects_absolute_and_parent_escape() {
        let root = tempfile_dir();
        let workspace = WorkspaceRoot::open(&root).unwrap();
        assert!(matches!(
            workspace.resolve("/tmp"),
            Err(WorkspaceError::Escape)
        ));
        assert!(matches!(
            workspace.resolve("../outside"),
            Err(WorkspaceError::Escape)
        ));
    }

    #[test]
    fn resolves_existing_file_inside_root() {
        let root = tempfile_dir();
        fs::write(root.join("ok.txt"), "ok").unwrap();
        let workspace = WorkspaceRoot::open(&root).unwrap();
        assert!(workspace
            .resolve("ok.txt")
            .unwrap()
            .starts_with(workspace.path()));
    }

    #[test]
    fn manifest_sig_tracks_pyproject_and_conf_changes() {
        let root = tempfile_dir();
        let empty = manifest_sig(Some(&root));
        assert!(empty.pyproject.is_none());
        assert!(empty.conf.is_none());

        fs::write(root.join("pyproject.toml"), "[project]\nname = \"demo\"\n").unwrap();
        let with_pyproject = manifest_sig(Some(&root));
        assert!(with_pyproject.pyproject.is_some());
        assert_ne!(empty, with_pyproject);

        fs::write(root.join("pyproject.toml"), "[project]\nname = \"fixed\"\n").unwrap();
        let rewritten = manifest_sig(Some(&root));
        assert_ne!(with_pyproject.pyproject, rewritten.pyproject);

        fs::write(root.join("conf.json"), "{\"type\":\"game\"}").unwrap();
        let with_conf = manifest_sig(Some(&root));
        assert!(with_conf.conf.is_some());
        assert_eq!(rewritten.pyproject, with_conf.pyproject);
        assert_ne!(rewritten, with_conf);
        let _ = fs::remove_dir_all(root);
    }

    fn tempfile_dir() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("dartsnut-workspace-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }
}
