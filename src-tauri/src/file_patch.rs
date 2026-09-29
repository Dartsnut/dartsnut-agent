use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const MAX_PATCH_BYTES: usize = 512_000;
const MAX_FILE_OPS: usize = 16;

enum PlanError {
    Soft(String),
    Hard(String),
}

struct Hunk {
    skip: Option<String>,
    old: Vec<String>,
    new: Vec<String>,
    eof: bool,
    added: usize,
    deleted: usize,
}

enum OpKind {
    Add,
    Delete,
    Update,
}

struct RawOp {
    kind: OpKind,
    rel: String,
    move_to: Option<String>,
    add_body: Vec<String>,
    hunks: Vec<Hunk>,
}

struct PlannedOp {
    rel: String,
    action: &'static str,
    write_path: Option<PathBuf>,
    content: Option<Vec<u8>>,
    delete_path: Option<PathBuf>,
    added: usize,
    deleted: usize,
    to: Option<String>,
}

pub fn apply_patch(root: &Path, patch: &str) -> Result<Value, String> {
    if patch.len() > MAX_PATCH_BYTES {
        return Ok(json!({"ok":false,"error":"patch too large"}));
    }
    match plan_patch(root, patch) {
        Ok(ops) => commit(ops),
        Err(PlanError::Soft(error)) => Ok(json!({"ok":false,"error":error})),
        Err(PlanError::Hard(error)) => Err(error),
    }
}

fn plan_patch(root: &Path, patch: &str) -> Result<Vec<PlannedOp>, PlanError> {
    let raw = parse_patch(patch)?;
    let mut planned = Vec::with_capacity(raw.len());
    for op in raw {
        planned.push(plan_op(root, op)?);
    }
    Ok(planned)
}

fn parse_patch(patch: &str) -> Result<Vec<RawOp>, PlanError> {
    let trimmed = patch.trim();
    let lines: Vec<&str> = if trimmed.is_empty() {
        Vec::new()
    } else {
        trimmed
            .split('\n')
            .map(|line| line.strip_suffix('\r').unwrap_or(line))
            .collect()
    };
    if lines.len() < 2
        || !lines[0].starts_with("*** Begin Patch")
        || lines[lines.len() - 1] != "*** End Patch"
    {
        return Err(PlanError::Soft("invalid patch text".into()));
    }

    let mut i = 1;
    if lines
        .get(i)
        .is_some_and(|line| line.starts_with("*** Environment ID:"))
    {
        i += 1;
    }

    let mut ops = Vec::new();
    let mut seen = HashSet::new();
    while i < lines.len() {
        let line = lines[i];
        if line == "*** End Patch" {
            break;
        }
        if let Some(rel) = line.strip_prefix("*** Add File: ") {
            i += 1;
            check_file_header(rel, line, &mut seen, ops.len())?;
            let (body, next) = parse_add_body(&lines, i)?;
            i = next;
            ops.push(RawOp {
                kind: OpKind::Add,
                rel: rel.to_string(),
                move_to: None,
                add_body: body,
                hunks: Vec::new(),
            });
            continue;
        }
        if let Some(rel) = line.strip_prefix("*** Delete File: ") {
            i += 1;
            check_file_header(rel, line, &mut seen, ops.len())?;
            ops.push(RawOp {
                kind: OpKind::Delete,
                rel: rel.to_string(),
                move_to: None,
                add_body: Vec::new(),
                hunks: Vec::new(),
            });
            continue;
        }
        if let Some(rel) = line.strip_prefix("*** Update File: ") {
            i += 1;
            check_file_header(rel, line, &mut seen, ops.len())?;
            let mut move_to = None;
            if let Some(dest_line) = lines.get(i) {
                if let Some(dest) = dest_line.strip_prefix("*** Move to: ") {
                    if dest.trim().is_empty() {
                        return Err(PlanError::Soft(format!("unknown line: {dest_line}")));
                    }
                    move_to = Some(dest.to_string());
                    i += 1;
                }
            }
            let (hunks, next) = parse_hunks(&lines, i)?;
            i = next;
            ops.push(RawOp {
                kind: OpKind::Update,
                rel: rel.to_string(),
                move_to,
                add_body: Vec::new(),
                hunks,
            });
            continue;
        }
        return Err(PlanError::Soft(format!("unknown line: {line}")));
    }
    if lines.get(i) != Some(&"*** End Patch") {
        return Err(PlanError::Soft("invalid patch text".into()));
    }
    Ok(ops)
}

fn check_file_header(
    rel: &str,
    line: &str,
    seen: &mut HashSet<String>,
    current_ops: usize,
) -> Result<(), PlanError> {
    if current_ops >= MAX_FILE_OPS {
        return Err(PlanError::Soft("too many files".into()));
    }
    if rel.trim().is_empty() {
        return Err(PlanError::Soft(format!("unknown line: {line}")));
    }
    if !seen.insert(rel.to_string()) {
        return Err(PlanError::Soft(format!("duplicate path: {rel}")));
    }
    Ok(())
}

fn parse_add_body(lines: &[&str], mut i: usize) -> Result<(Vec<String>, usize), PlanError> {
    let mut body = Vec::new();
    while i < lines.len() {
        let line = lines[i];
        if is_file_boundary(line) {
            break;
        }
        if !line.starts_with('+') {
            return Err(PlanError::Soft(format!("invalid add file line: {line}")));
        }
        body.push(line[1..].to_string());
        i += 1;
    }
    Ok((body, i))
}

fn parse_hunks(lines: &[&str], mut i: usize) -> Result<(Vec<Hunk>, usize), PlanError> {
    let mut hunks = Vec::new();
    loop {
        if i >= lines.len() || is_file_boundary(lines[i]) || lines[i] == "***" {
            break;
        }
        let mut skip = None;
        if lines[i].starts_with("@@") {
            let rest = &lines[i][2..];
            let desc = rest.strip_prefix(' ').unwrap_or(rest);
            if !desc.is_empty() {
                skip = Some(desc.to_string());
            }
            i += 1;
        } else if !hunks.is_empty() {
            let line = lines[i];
            if line.starts_with("***") {
                return Err(PlanError::Soft(format!("unknown line: {line}")));
            }
            return Err(PlanError::Soft(format!("invalid hunk line: {line}")));
        }
        if i >= lines.len() || is_file_boundary(lines[i]) || lines[i] == "***" {
            if skip.is_some() {
                let line = lines.get(i).copied().unwrap_or("*** End Patch");
                return Err(PlanError::Soft(format!("invalid hunk line: {line}")));
            }
            break;
        }
        let (hunk, next) = parse_hunk_body(lines, i, skip)?;
        i = next;
        hunks.push(hunk);
    }
    if i < lines.len() && lines[i] == "***" {
        i += 1;
    }
    Ok((hunks, i))
}

fn parse_hunk_body(
    lines: &[&str],
    mut i: usize,
    skip: Option<String>,
) -> Result<(Hunk, usize), PlanError> {
    let start = i;
    let mut old = Vec::new();
    let mut new = Vec::new();
    let mut added = 0;
    let mut deleted = 0;
    while i < lines.len() {
        let line = lines[i];
        if line == "\\ No newline at end of file" {
            i += 1;
            continue;
        }
        if line.starts_with("@@") || is_file_boundary(line) || line == "***" {
            break;
        }
        if line.starts_with("***") {
            return Err(PlanError::Soft(format!("unknown line: {line}")));
        }
        if line.is_empty() {
            old.push(String::new());
            new.push(String::new());
            i += 1;
            continue;
        }
        match line.as_bytes().first().copied() {
            Some(b'+') => {
                added += 1;
                new.push(line[1..].to_string());
            }
            Some(b'-') => {
                deleted += 1;
                old.push(line[1..].to_string());
            }
            Some(b' ') => {
                let text = line[1..].to_string();
                old.push(text.clone());
                new.push(text);
            }
            _ => {
                return Err(PlanError::Soft(format!("invalid hunk line: {line}")));
            }
        }
        i += 1;
    }
    if i == start {
        let line = lines.get(i).copied().unwrap_or("*** End Patch");
        return Err(PlanError::Soft(format!("invalid hunk line: {line}")));
    }
    let eof = if i < lines.len() && lines[i] == "*** End of File" {
        i += 1;
        true
    } else {
        false
    };
    Ok((
        Hunk {
            skip,
            old,
            new,
            eof,
            added,
            deleted,
        },
        i,
    ))
}

fn is_file_boundary(line: &str) -> bool {
    line == "*** End Patch"
        || line == "*** End of File"
        || line.starts_with("*** Update File:")
        || line.starts_with("*** Delete File:")
        || line.starts_with("*** Add File:")
}

fn plan_op(root: &Path, op: RawOp) -> Result<PlannedOp, PlanError> {
    let source = jail(root, &op.rel)?;
    match op.kind {
        OpKind::Add => {
            if source.exists() {
                return Err(PlanError::Soft(format!("add file exists: {}", op.rel)));
            }
            let content = op.add_body.join("\n");
            Ok(PlannedOp {
                added: op.add_body.len(),
                deleted: 0,
                rel: op.rel,
                action: "add",
                write_path: Some(source),
                content: Some(content.into_bytes()),
                delete_path: None,
                to: None,
            })
        }
        OpKind::Delete => {
            if !source.exists() {
                return Err(PlanError::Soft(format!("delete missing file: {}", op.rel)));
            }
            if source.is_dir() {
                return Err(PlanError::Soft(format!("path is a directory: {}", op.rel)));
            }
            Ok(PlannedOp {
                rel: op.rel,
                action: "delete",
                write_path: None,
                content: None,
                delete_path: Some(source),
                added: 0,
                deleted: 0,
                to: None,
            })
        }
        OpKind::Update => {
            if !source.exists() {
                return Err(PlanError::Soft(format!("update missing file: {}", op.rel)));
            }
            if source.is_dir() {
                return Err(PlanError::Soft(format!("path is a directory: {}", op.rel)));
            }
            let dest_rel = op.move_to.clone();
            let dest = match dest_rel.as_deref() {
                Some(rel) => {
                    let path = jail(root, rel)?;
                    if path.exists() {
                        return Err(PlanError::Soft(format!("move destination exists: {rel}")));
                    }
                    Some(path)
                }
                None => None,
            };
            let (text, crlf) = read_utf8(&source)?;
            let mut file_lines = split_file_lines(&text);
            let (added, deleted) = apply_hunks(&mut file_lines, &op.hunks, &op.rel)?;
            let joined = join_file_lines(&file_lines, crlf);
            let action = if dest.is_some() { "move" } else { "update" };
            Ok(PlannedOp {
                rel: op.rel,
                action,
                write_path: Some(dest.unwrap_or(source.clone())),
                content: Some(joined.into_bytes()),
                delete_path: dest_rel.as_ref().map(|_| source),
                added,
                deleted,
                to: dest_rel,
            })
        }
    }
}

fn jail(root: &Path, rel: &str) -> Result<PathBuf, PlanError> {
    crate::rig_runtime::safe_path(root, Some(&Value::String(rel.to_string())))
        .map_err(PlanError::Hard)
}

fn read_utf8(path: &Path) -> Result<(String, bool), PlanError> {
    let bytes = std::fs::read(path).map_err(|e| PlanError::Hard(e.to_string()))?;
    let text = String::from_utf8(bytes)
        .map_err(|_| PlanError::Soft("file is not valid UTF-8".into()))?;
    let crlf = text.contains("\r\n");
    Ok((text, crlf))
}

fn split_file_lines(text: &str) -> Vec<String> {
    text.split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line).to_string())
        .collect()
}

fn join_file_lines(lines: &[String], crlf: bool) -> String {
    let sep = if crlf { "\r\n" } else { "\n" };
    lines.join(sep)
}

fn apply_hunks(lines: &mut Vec<String>, hunks: &[Hunk], path: &str) -> Result<(usize, usize), PlanError> {
    let mut cursor = 0;
    let mut added = 0;
    let mut deleted = 0;
    for hunk in hunks {
        if let Some(desc) = &hunk.skip {
            if let Some(idx) = find_skip(lines, desc, cursor) {
                cursor = idx + 1;
            }
        }
        let idx = if hunk.eof {
            let eof_at = lines.len().saturating_sub(hunk.old.len());
            find_block(lines, &hunk.old, eof_at).or_else(|| find_block(lines, &hunk.old, cursor))
        } else {
            find_block(lines, &hunk.old, cursor)
        };
        let Some(idx) = idx else {
            return Err(PlanError::Soft(format!("hunk not found in {path}")));
        };
        lines.splice(idx..idx + hunk.old.len(), hunk.new.iter().cloned());
        cursor = idx + hunk.new.len();
        added += hunk.added;
        deleted += hunk.deleted;
    }
    Ok((added, deleted))
}

fn find_skip(lines: &[String], desc: &str, start: usize) -> Option<usize> {
    let start = start.min(lines.len());
    lines[start..]
        .iter()
        .position(|line| line == desc)
        .or_else(|| {
            lines[start..]
                .iter()
                .position(|line| line.trim() == desc.trim())
        })
        .map(|offset| start + offset)
}

fn find_block(lines: &[String], old: &[String], start: usize) -> Option<usize> {
    if old.is_empty() {
        return Some(start.min(lines.len()));
    }
    if old.len() > lines.len() {
        return None;
    }
    let last = lines.len() - old.len();
    if start > last {
        return None;
    }
    for mode in 0..3 {
        for i in start..=last {
            if lines_equal(&lines[i..i + old.len()], old, mode) {
                return Some(i);
            }
        }
    }
    None
}

fn lines_equal(a: &[String], b: &[String], mode: u8) -> bool {
    a.iter().zip(b).all(|(left, right)| match mode {
        0 => left == right,
        1 => left.trim_end() == right.trim_end(),
        _ => left.trim() == right.trim(),
    })
}

fn commit(ops: Vec<PlannedOp>) -> Result<Value, String> {
    for op in &ops {
        if let (Some(path), Some(content)) = (&op.write_path, &op.content) {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(path, content).map_err(|e| e.to_string())?;
        }
    }
    for op in &ops {
        if let Some(path) = &op.delete_path {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    let files: Vec<Value> = ops
        .iter()
        .map(|op| {
            let mut file = json!({
                "path": op.rel,
                "action": op.action,
                "added": op.added,
                "deleted": op.deleted,
            });
            if let Some(to) = &op.to {
                file["to"] = json!(to);
            }
            file
        })
        .collect();
    Ok(json!({"ok":true,"files":files}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("dartsnut-patch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn patch(body: &str) -> String {
        format!("*** Begin Patch\n{body}*** End Patch")
    }

    #[test]
    fn add_file_single_line_has_no_extra_newline() {
        let root = temp_root();
        let result = apply_patch(
            &root,
            &patch("*** Add File: hello.txt\n+hi\n"),
        )
        .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["files"][0]["path"], "hello.txt");
        assert_eq!(result["files"][0]["action"], "add");
        assert_eq!(result["files"][0]["added"], 1);
        assert_eq!(result["files"][0]["deleted"], 0);
        assert!(result["files"][0].get("to").is_none());
        assert_eq!(std::fs::read(root.join("hello.txt")).unwrap(), b"hi");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn update_preserves_crlf() {
        let root = temp_root();
        std::fs::write(root.join("crlf.txt"), "hello\r\nworld\r\n").unwrap();
        let result = apply_patch(
            &root,
            &patch("*** Update File: crlf.txt\n@@\n hello\n-world\n+there\n"),
        )
        .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["files"][0]["action"], "update");
        assert_eq!(std::fs::read(root.join("crlf.txt")).unwrap(), b"hello\r\nthere\r\n");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn trailing_space_mismatch_applies_via_rstrip() {
        let root = temp_root();
        std::fs::write(root.join("a.txt"), "hello  \nworld\n").unwrap();
        let result = apply_patch(
            &root,
            &patch("*** Update File: a.txt\n@@\n hello\n-world\n+there\n"),
        )
        .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "hello\nthere\n");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn missing_hunk_leaves_file_unchanged() {
        let root = temp_root();
        std::fs::write(root.join("a.txt"), "hello\n").unwrap();
        let result = apply_patch(
            &root,
            &patch("*** Update File: a.txt\n@@\n-missing\n+nope\n"),
        )
        .unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"], "hunk not found in a.txt");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "hello\n");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn add_file_exists_leaves_file_unchanged() {
        let root = temp_root();
        std::fs::write(root.join("hello.txt"), "keep").unwrap();
        let result = apply_patch(
            &root,
            &patch("*** Add File: hello.txt\n+hi\n"),
        )
        .unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"], "add file exists: hello.txt");
        assert_eq!(std::fs::read_to_string(root.join("hello.txt")).unwrap(), "keep");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn delete_file_and_directory_rejection() {
        let root = temp_root();
        std::fs::write(root.join("gone.txt"), "x").unwrap();
        std::fs::create_dir_all(root.join("dir")).unwrap();
        let deleted = apply_patch(&root, &patch("*** Delete File: gone.txt\n")).unwrap();
        assert_eq!(deleted["ok"], true);
        assert_eq!(deleted["files"][0]["action"], "delete");
        assert_eq!(deleted["files"][0]["added"], 0);
        assert_eq!(deleted["files"][0]["deleted"], 0);
        assert!(!root.join("gone.txt").exists());
        let dir = apply_patch(&root, &patch("*** Delete File: dir\n")).unwrap();
        assert_eq!(dir["ok"], false);
        assert_eq!(dir["error"], "path is a directory: dir");
        assert!(root.join("dir").is_dir());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn update_move_writes_dest_and_removes_source() {
        let root = temp_root();
        std::fs::write(root.join("old.txt"), "old\n").unwrap();
        let result = apply_patch(
            &root,
            &patch("*** Update File: old.txt\n*** Move to: new.txt\n@@\n-old\n+new\n"),
        )
        .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["files"][0]["action"], "move");
        assert_eq!(result["files"][0]["path"], "old.txt");
        assert_eq!(result["files"][0]["to"], "new.txt");
        assert!(!root.join("old.txt").exists());
        assert_eq!(std::fs::read_to_string(root.join("new.txt")).unwrap(), "new\n");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn failed_second_hunk_does_not_commit_first_file() {
        let root = temp_root();
        std::fs::write(root.join("b.txt"), "keep\n").unwrap();
        let result = apply_patch(
            &root,
            &patch("*** Add File: a.txt\n+hello\n*** Update File: b.txt\n@@\n-missing\n+nope\n"),
        )
        .unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"], "hunk not found in b.txt");
        assert!(!root.join("a.txt").exists());
        assert_eq!(std::fs::read_to_string(root.join("b.txt")).unwrap(), "keep\n");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn path_escape_is_hard_error() {
        let root = temp_root();
        let err = apply_patch(&root, &patch("*** Add File: ../secret\n+x\n")).unwrap_err();
        assert_eq!(err, "path escapes workspace root");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn too_many_files_and_patch_too_large() {
        let root = temp_root();
        let mut many = String::from("*** Begin Patch\n");
        for i in 0..17 {
            many.push_str(&format!("*** Add File: f{i}.txt\n+x\n"));
        }
        many.push_str("*** End Patch");
        let too_many = apply_patch(&root, &many).unwrap();
        assert_eq!(too_many["ok"], false);
        assert_eq!(too_many["error"], "too many files");
        let too_large = apply_patch(&root, &"x".repeat(512_001)).unwrap();
        assert_eq!(too_large["ok"], false);
        assert_eq!(too_large["error"], "patch too large");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn duplicate_update_path() {
        let root = temp_root();
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        let result = apply_patch(
            &root,
            &patch("*** Update File: a.txt\n@@\n-a\n+b\n*** Update File: a.txt\n@@\n-b\n+c\n"),
        )
        .unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"], "duplicate path: a.txt");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "a\n");
        let _ = std::fs::remove_dir_all(root);
    }
}
