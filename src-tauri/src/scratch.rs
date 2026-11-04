//! Structural recognition of a Scratch 3 (`.sb3`) workspace.
//!
//! The device firmware is authoritative for what a Scratch payload may contain —
//! refused extensions, custom extension URLs, costume `viewBox` derivation, the
//! music refusal. Those rules are enforced at install and deliberately not
//! duplicated here: two copies of a rule drift the first time the device
//! changes. Cero checks structure only, and only what it needs to tell the user
//! at open time that the folder is not one it can use:
//!
//! - exactly one `.sb3` at the workspace **root**, case-insensitively, ignoring
//!   AppleDouble `._` companion files;
//! - it opens as a zip;
//! - it holds `project.json` whose `targets` is a non-empty list.
//!
//! `pyproject.toml` beside an `.sb3` is reported as ambiguous rather than
//! classified: the device would refuse that folder at install, so refusing it
//! at open is the earlier, cheaper moment to say so.

use serde_json::Value;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Why a folder that offers `.sb3` payloads is not a Scratch workspace.
///
/// These strings are the `DeployEligibilityReason` codes the renderer keys its
/// fault copy off; keep them in step with `contracts.ts`.
pub const MULTIPLE_PROJECTS: &str = "scratch_multiple_projects";
pub const AMBIGUOUS_WITH_PYTHON: &str = "scratch_ambiguous_with_python";
pub const UNPARSEABLE: &str = "scratch_unparseable";

/// The backend's answer to "what kind of project is this workspace?".
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ScratchWorkspace {
    /// No `.sb3` at the root — an ordinary workspace, classified the old way.
    Absent,
    /// Exactly one usable `.sb3` at the root.
    Project { path: PathBuf, app_id: String },
    /// The folder presents a Scratch payload the device would refuse.
    Refused {
        reason: &'static str,
        problems: Vec<&'static str>,
    },
}

/// True when the folder is a usable Scratch workspace. Convenience for callers
/// that only need the yes/no and are not reporting a refusal.
pub fn is_scratch_at(root: impl AsRef<Path>) -> bool {
    matches!(
        scan_workspace(root.as_ref()),
        ScratchWorkspace::Project { .. }
    )
}

/// The refusal code for a folder, or `None` when it is not refused.
pub fn open_refusal_reason(root: &Path) -> Option<&'static str> {
    match scan_workspace(root) {
        ScratchWorkspace::Refused { reason, .. } => Some(reason),
        ScratchWorkspace::Project { .. } | ScratchWorkspace::Absent => None,
    }
}

/// Plain-words refusal copy: what is wrong and what to do about it. Written for
/// the person who just picked the folder, not for the agent.
pub fn refusal_message(reason: &str) -> &'static str {
    match reason {
        MULTIPLE_PROJECTS => {
            "This folder has more than one .sb3 file. Keep a single .sb3 at the folder root."
        }
        AMBIGUOUS_WITH_PYTHON => {
            "This folder has a .sb3 file and a pyproject.toml. A project is one or the other: move the .sb3 into its own folder, or remove pyproject.toml."
        }
        _ => {
            "This .sb3 file could not be opened as a Scratch project. It may be damaged, or it may not have a project.json with any targets."
        }
    }
}

/// The project kind reported to the renderer. `None` when there is no workspace.
pub fn project_kind(root: Option<&Path>) -> Option<&'static str> {
    root.map(|root| match scan_workspace(root) {
        ScratchWorkspace::Project { .. } => "scratch",
        ScratchWorkspace::Absent | ScratchWorkspace::Refused { .. } => "python",
    })
}

/// Classifies a workspace root, reading the archives it finds.
pub fn scan_workspace(root: &Path) -> ScratchWorkspace {
    classify_candidates(root, workspace_candidates(root))
}

/// The rule itself, with the directory read lifted out so it can be tested
/// without a filesystem.
pub fn classify_candidates(root: &Path, mut candidates: Vec<PathBuf>) -> ScratchWorkspace {
    candidates.sort();
    match candidates.len() {
        0 => ScratchWorkspace::Absent,
        1 => {
            let candidate = candidates.remove(0);
            if root.join("pyproject.toml").is_file() {
                return ScratchWorkspace::Refused {
                    reason: AMBIGUOUS_WITH_PYTHON,
                    problems: vec![AMBIGUOUS_WITH_PYTHON],
                };
            }
            match archive_problem(&candidate) {
                None => ScratchWorkspace::Project {
                    app_id: file_stem(&candidate),
                    path: candidate,
                },
                Some(problem) => ScratchWorkspace::Refused {
                    reason: problem,
                    problems: vec![problem],
                },
            }
        }
        _ => ScratchWorkspace::Refused {
            reason: MULTIPLE_PROJECTS,
            problems: vec![MULTIPLE_PROJECTS],
        },
    }
}

/// The `.sb3` files sitting directly in `root`, ignoring AppleDouble companions.
fn workspace_candidates(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter(|entry| is_scratch_candidate(&entry.file_name().to_string_lossy()))
        .map(|entry| entry.path())
        .collect()
}

/// A `.sb3` name, matched case-insensitively. A leading `._` marks an
/// AppleDouble resource fork — the sidecar macOS writes next to a copied file —
/// not a second project.
pub fn is_scratch_candidate(file_name: &str) -> bool {
    !file_name.starts_with("._")
        && file_name.rsplit_once('.').is_some_and(|(stem, extension)| {
            !stem.is_empty() && extension.eq_ignore_ascii_case("sb3")
        })
}

/// Opens the archive and reports the first structural problem, or `None` when
/// it is usable. Only what Cero needs: readable zip, manifest, non-empty targets.
pub fn archive_problem(path: &Path) -> Option<&'static str> {
    archive_problem_for(|| fs::read(path))
}

/// `archive_problem` over an injected reader, so the contents rule can be
/// exercised without building archive files on disk.
fn archive_problem_for(read: impl FnOnce() -> std::io::Result<Vec<u8>>) -> Option<&'static str> {
    let bytes = match read() {
        Ok(bytes) => bytes,
        Err(_) => return Some(UNPARSEABLE),
    };
    let cursor = std::io::Cursor::new(bytes);
    project_json_targets(cursor).err().map(|()| UNPARSEABLE)
}

/// Reads `project.json` out of a `.sb3` and answers "does it carry targets?".
///
/// `Err(())` covers both "not a zip" and "no usable manifest": from the user's
/// side those are one fault, and the copy names both. Separating them would add
/// a reason code nobody can act on differently.
fn project_json_targets(reader: impl Read + std::io::Seek) -> Result<(), ()> {
    let mut archive = zip::ZipArchive::new(reader).map_err(|_| ())?;
    let mut manifest = None;
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|_| ())?;
        let name = file.name().trim_start_matches("./");
        if name == "project.json" {
            manifest = Some(index);
            break;
        }
    }
    let manifest = manifest.ok_or(())?;
    let mut file = archive.by_index(manifest).map_err(|_| ())?;
    let mut body = String::new();
    file.read_to_string(&mut body).map_err(|_| ())?;
    let manifest: Value = serde_json::from_str(&body).map_err(|_| ())?;
    match manifest.get("targets").and_then(Value::as_array) {
        Some(targets) if !targets.is_empty() => Ok(()),
        _ => Err(()),
    }
}

/// `game.sb3` names the project `game`: the firmware derives its install
/// identity from the payload, and the file stem is what the user recognises.
pub fn file_stem(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Scratch project".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// The shape a real `.sb3` has: a zip with a `project.json` manifest.
    fn write_sb3(path: &Path, manifest: &str) {
        let file = fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("project.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(manifest.as_bytes()).unwrap();
        writer
            .start_file("stage.svg", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"<svg/>").unwrap();
        writer.finish().unwrap();
    }

    const USABLE: &str = r#"{"targets":[{"isStage":true,"name":"Stage"}]}"#;

    fn temp_root(label: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("dartsnut-scratch-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn scanned(root: &Path) -> ScratchWorkspace {
        let workspace = scan_workspace(root);
        let _ = fs::remove_dir_all(root);
        workspace
    }

    #[test]
    fn one_sb3_at_the_root_is_the_project() {
        let root = temp_root("single");
        write_sb3(&root.join("game.sb3"), USABLE);
        assert_eq!(
            scanned(&root),
            ScratchWorkspace::Project {
                path: root.join("game.sb3"),
                app_id: "game".to_owned()
            }
        );
    }

    #[test]
    fn extension_matches_case_insensitively() {
        let root = temp_root("uppercase");
        write_sb3(&root.join("Game.SB3"), USABLE);
        assert!(matches!(
            scanned(&root),
            ScratchWorkspace::Project { app_id, .. } if app_id == "Game"
        ));
    }

    #[test]
    fn macos_companion_files_do_not_count_as_projects() {
        let root = temp_root("appledouble");
        write_sb3(&root.join("game.sb3"), USABLE);
        fs::write(root.join("._game.sb3"), b"appledouble").unwrap();
        assert!(matches!(
            scanned(&root),
            ScratchWorkspace::Project { app_id, .. } if app_id == "game"
        ));
    }

    #[test]
    fn a_sb3_in_a_subdirectory_leaves_the_workspace_python() {
        let root = temp_root("nested");
        fs::create_dir_all(root.join("assets")).unwrap();
        write_sb3(&root.join("assets").join("game.sb3"), USABLE);
        assert_eq!(scanned(&root), ScratchWorkspace::Absent);
    }

    #[test]
    fn two_sb3_at_the_root_are_refused() {
        let root = temp_root("two");
        write_sb3(&root.join("one.sb3"), USABLE);
        write_sb3(&root.join("two.sb3"), USABLE);
        assert_eq!(
            scanned(&root),
            ScratchWorkspace::Refused {
                reason: MULTIPLE_PROJECTS,
                problems: vec![MULTIPLE_PROJECTS]
            }
        );
    }

    #[test]
    fn an_sb3_beside_a_pyproject_is_ambiguous() {
        let root = temp_root("ambiguous");
        write_sb3(&root.join("game.sb3"), USABLE);
        fs::write(root.join("pyproject.toml"), "[project]\n").unwrap();
        assert_eq!(
            scanned(&root),
            ScratchWorkspace::Refused {
                reason: AMBIGUOUS_WITH_PYTHON,
                problems: vec![AMBIGUOUS_WITH_PYTHON]
            }
        );
    }

    #[test]
    fn a_file_that_is_not_a_zip_is_unparseable() {
        let root = temp_root("notzip");
        fs::write(root.join("game.sb3"), b"definitely not a zip").unwrap();
        assert_eq!(
            scanned(&root),
            ScratchWorkspace::Refused {
                reason: UNPARSEABLE,
                problems: vec![UNPARSEABLE]
            }
        );
    }

    #[test]
    fn a_zip_without_a_project_manifest_is_unparseable() {
        let root = temp_root("nomanifest");
        let file = fs::File::create(root.join("game.sb3")).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("sprite1.svg", zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"<svg/>").unwrap();
        writer.finish().unwrap();
        assert_eq!(
            scanned(&root),
            ScratchWorkspace::Refused {
                reason: UNPARSEABLE,
                problems: vec![UNPARSEABLE]
            }
        );
    }

    #[test]
    fn a_manifest_without_targets_is_unparseable() {
        for manifest in [r#"{"targets":[]}"#, r#"{"targets":"Stage"}"#, "{}"] {
            let root = temp_root("notargets");
            write_sb3(&root.join("game.sb3"), manifest);
            assert_eq!(
                scanned(&root),
                ScratchWorkspace::Refused {
                    reason: UNPARSEABLE,
                    problems: vec![UNPARSEABLE]
                },
                "manifest {manifest} must be refused"
            );
        }
    }

    #[test]
    fn a_missing_workspace_directory_reads_as_absent() {
        let root =
            std::env::temp_dir().join(format!("dartsnut-scratch-gone-{}", uuid::Uuid::new_v4()));
        assert_eq!(scan_workspace(&root), ScratchWorkspace::Absent);
    }

    #[test]
    fn project_kind_reports_scratch_only_for_a_usable_payload() {
        let root = temp_root("kind");
        assert_eq!(project_kind(Some(&root)), Some("python"));
        write_sb3(&root.join("game.sb3"), USABLE);
        assert_eq!(project_kind(Some(&root)), Some("scratch"));
        write_sb3(&root.join("other.sb3"), USABLE);
        assert_eq!(project_kind(Some(&root)), Some("python"));
        assert_eq!(project_kind(None), None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn every_refusal_names_the_rule_and_the_fix() {
        for reason in [MULTIPLE_PROJECTS, AMBIGUOUS_WITH_PYTHON, UNPARSEABLE] {
            let message = refusal_message(reason).to_lowercase();
            assert!(
                message.contains(".sb3"),
                "refusal copy for {reason} must name the payload: {message}"
            );
            assert!(
                message.contains("keep")
                    || message.contains("move")
                    || message.contains("remove")
                    || message.contains("could not be opened"),
                "refusal copy for {reason} must say what to fix: {message}"
            );
        }
    }

    #[test]
    fn candidates_ignore_non_files_and_other_extensions() {
        let root = temp_root("candidates");
        fs::create_dir_all(root.join("nested.sb3")).unwrap();
        fs::write(root.join("game.sb3.bak"), b"backup").unwrap();
        fs::write(root.join(".sb3"), b"no stem").unwrap();
        write_sb3(&root.join("game.sb3"), USABLE);
        assert_eq!(workspace_candidates(&root), vec![root.join("game.sb3")]);
        let _ = fs::remove_dir_all(root);
    }
}
