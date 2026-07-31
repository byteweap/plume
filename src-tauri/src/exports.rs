use std::{
    collections::HashMap,
    fs::File,
    io::{self, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use serde::{Deserialize, Serialize};
use tempfile::{Builder, NamedTempFile};
use thiserror::Error;
use uuid::Uuid;

pub const CSV_EXPORT_PROGRESS_EVENT: &str = "csv-export-progress";
pub const JSON_EXPORT_PROGRESS_EVENT: &str = "json-export-progress";
const MAX_EXPORT_ROWS: usize = 10_000;
const MAX_EXPORT_COLUMNS: usize = 2_048;
const PROGRESS_ROW_INTERVAL: usize = 256;

pub struct AtomicExportFile {
    target_path: PathBuf,
    temporary_file: NamedTempFile,
}

impl AtomicExportFile {
    pub fn create(target_path: PathBuf) -> Result<Self, ExportError> {
        let parent = target_path.parent().ok_or_else(|| {
            ExportError::Invalid("The export target must have a parent directory.".to_owned())
        })?;
        let temporary_file = Builder::new()
            .prefix(".plume-export-")
            .suffix(".tmp")
            .tempfile_in(parent)?;
        Ok(Self {
            target_path,
            temporary_file,
        })
    }

    pub fn file_mut(&mut self) -> &mut File {
        self.temporary_file.as_file_mut()
    }

    pub fn commit(self) -> Result<(), ExportError> {
        self.temporary_file.as_file().sync_all()?;
        self.temporary_file
            .persist(&self.target_path)
            .map_err(|error| ExportError::Persist(error.error))?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CsvDelimiter {
    Comma,
    Semicolon,
    Tab,
}

impl CsvDelimiter {
    fn as_char(self) -> char {
        match self {
            Self::Comma => ',',
            Self::Semicolon => ';',
            Self::Tab => '\t',
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub enum CsvEncoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16le")]
    Utf16Le,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvExportRequest {
    pub task_id: String,
    pub suggested_file_name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub include_headers: bool,
    pub delimiter: CsvDelimiter,
    pub encoding: CsvEncoding,
}

impl CsvExportRequest {
    pub fn validate(&self) -> Result<(), ExportError> {
        validate_export_request(
            &self.task_id,
            &self.suggested_file_name,
            &self.columns,
            &self.rows,
            "CSV",
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonExportRequest {
    pub task_id: String,
    pub suggested_file_name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
}

impl JsonExportRequest {
    pub fn validate(&self) -> Result<(), ExportError> {
        validate_export_request(
            &self.task_id,
            &self.suggested_file_name,
            &self.columns,
            &self.rows,
            "JSON",
        )
    }
}

fn validate_export_request(
    task_id: &str,
    suggested_file_name: &str,
    columns: &[String],
    rows: &[Vec<Option<String>>],
    format: &str,
) -> Result<(), ExportError> {
    Uuid::parse_str(task_id)
        .map_err(|_| ExportError::Invalid("Task ID must be a UUID.".to_owned()))?;
    if suggested_file_name.trim().is_empty()
        || suggested_file_name.len() > 128
        || suggested_file_name
            .chars()
            .any(|character| matches!(character, '/' | '\\' | '\0'))
    {
        return Err(ExportError::Invalid(
            "Suggested file name is invalid.".to_owned(),
        ));
    }
    if columns.is_empty() || columns.len() > MAX_EXPORT_COLUMNS {
        return Err(ExportError::Invalid(format!(
            "{format} exports require between 1 and {MAX_EXPORT_COLUMNS} columns."
        )));
    }
    if rows.len() > MAX_EXPORT_ROWS {
        return Err(ExportError::Invalid(format!(
            "{format} exports cannot exceed {MAX_EXPORT_ROWS} retained rows."
        )));
    }
    if rows.iter().any(|row| row.len() != columns.len()) {
        return Err(ExportError::Invalid(format!(
            "Every {format} row must match the exported column count."
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvExportProgress {
    pub task_id: String,
    pub completed_rows: u64,
    pub total_rows: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CsvExportStatus {
    Completed,
    Dismissed,
    Cancelled,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvExportResult {
    pub task_id: String,
    pub status: CsvExportStatus,
    pub rows_written: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonExportProgress {
    pub task_id: String,
    pub completed_rows: u64,
    pub total_rows: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JsonExportStatus {
    Completed,
    Dismissed,
    Cancelled,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonExportResult {
    pub task_id: String,
    pub status: JsonExportStatus,
    pub rows_written: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelExportRequest {
    pub task_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CancelExportStatus {
    Requested,
    AlreadyFinished,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelExportResult {
    pub task_id: String,
    pub status: CancelExportStatus,
}

#[derive(Default)]
pub struct ExportRegistry {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl ExportRegistry {
    pub fn register(&self, task_id: &str) -> Result<Arc<AtomicBool>, ExportError> {
        Uuid::parse_str(task_id)
            .map_err(|_| ExportError::Invalid("Task ID must be a UUID.".to_owned()))?;
        let mut active = self.active.lock().map_err(|_| ExportError::Lock)?;
        if active.contains_key(task_id) {
            return Err(ExportError::AlreadyRunning(task_id.to_owned()));
        }

        let cancelled = Arc::new(AtomicBool::new(false));
        active.insert(task_id.to_owned(), Arc::clone(&cancelled));
        Ok(cancelled)
    }

    pub fn cancel(&self, request: CancelExportRequest) -> Result<CancelExportResult, ExportError> {
        Uuid::parse_str(&request.task_id)
            .map_err(|_| ExportError::Invalid("Task ID must be a UUID.".to_owned()))?;
        let active = self.active.lock().map_err(|_| ExportError::Lock)?;
        let status = if let Some(cancelled) = active.get(&request.task_id) {
            cancelled.store(true, Ordering::Release);
            CancelExportStatus::Requested
        } else {
            CancelExportStatus::AlreadyFinished
        };
        Ok(CancelExportResult {
            task_id: request.task_id,
            status,
        })
    }

    pub fn finish(&self, task_id: &str) -> Result<(), ExportError> {
        self.active
            .lock()
            .map_err(|_| ExportError::Lock)?
            .remove(task_id);
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CsvWriteOutcome {
    Completed(u64),
    Cancelled(u64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JsonWriteOutcome {
    Completed(u64),
    Cancelled(u64),
}

pub fn write_csv<W, F>(
    writer: &mut W,
    request: &CsvExportRequest,
    cancelled: &AtomicBool,
    mut report_progress: F,
) -> Result<CsvWriteOutcome, ExportError>
where
    W: Write,
    F: FnMut(CsvExportProgress) -> Result<(), ExportError>,
{
    request.validate()?;
    let total_rows = request.rows.len() as u64;
    report_progress(CsvExportProgress {
        task_id: request.task_id.clone(),
        completed_rows: 0,
        total_rows,
    })?;

    if cancelled.load(Ordering::Acquire) {
        writer.flush()?;
        return Ok(CsvWriteOutcome::Cancelled(0));
    }

    write_preamble(writer, request.encoding)?;
    if request.include_headers {
        write_record(
            writer,
            request.columns.iter().map(|value| Some(value.as_str())),
            request.delimiter,
            request.encoding,
        )?;
    }

    for (index, row) in request.rows.iter().enumerate() {
        if cancelled.load(Ordering::Acquire) {
            writer.flush()?;
            return Ok(CsvWriteOutcome::Cancelled(index as u64));
        }

        write_record(
            writer,
            row.iter().map(Option::as_deref),
            request.delimiter,
            request.encoding,
        )?;
        let completed_rows = index + 1;
        if completed_rows % PROGRESS_ROW_INTERVAL == 0 || completed_rows == request.rows.len() {
            report_progress(CsvExportProgress {
                task_id: request.task_id.clone(),
                completed_rows: completed_rows as u64,
                total_rows,
            })?;
        }
    }

    writer.flush()?;
    Ok(CsvWriteOutcome::Completed(total_rows))
}

pub fn write_json<W, F>(
    writer: &mut W,
    request: &JsonExportRequest,
    cancelled: &AtomicBool,
    mut report_progress: F,
) -> Result<JsonWriteOutcome, ExportError>
where
    W: Write,
    F: FnMut(JsonExportProgress) -> Result<(), ExportError>,
{
    request.validate()?;
    let total_rows = request.rows.len() as u64;
    report_progress(JsonExportProgress {
        task_id: request.task_id.clone(),
        completed_rows: 0,
        total_rows,
    })?;

    if cancelled.load(Ordering::Acquire) {
        writer.flush()?;
        return Ok(JsonWriteOutcome::Cancelled(0));
    }

    let keys = unique_json_keys(&request.columns);
    writer.write_all(b"[")?;
    for (index, row) in request.rows.iter().enumerate() {
        if cancelled.load(Ordering::Acquire) {
            writer.flush()?;
            return Ok(JsonWriteOutcome::Cancelled(index as u64));
        }

        if index > 0 {
            writer.write_all(b",")?;
        }
        writer.write_all(b"\n  {")?;
        for (column_index, (key, value)) in keys.iter().zip(row).enumerate() {
            if column_index > 0 {
                writer.write_all(b",")?;
            }
            writer.write_all(b"\n    ")?;
            serde_json::to_writer(&mut *writer, key)?;
            writer.write_all(b": ")?;
            serde_json::to_writer(&mut *writer, value)?;
        }
        writer.write_all(b"\n  }")?;

        let completed_rows = index + 1;
        if completed_rows % PROGRESS_ROW_INTERVAL == 0 || completed_rows == request.rows.len() {
            report_progress(JsonExportProgress {
                task_id: request.task_id.clone(),
                completed_rows: completed_rows as u64,
                total_rows,
            })?;
        }
    }
    if request.rows.is_empty() {
        writer.write_all(b"]\n")?;
    } else {
        writer.write_all(b"\n]\n")?;
    }
    writer.flush()?;
    Ok(JsonWriteOutcome::Completed(total_rows))
}

fn unique_json_keys(columns: &[String]) -> Vec<String> {
    use std::collections::HashSet;

    let reserved = columns.iter().cloned().collect::<HashSet<_>>();
    let mut used = HashSet::with_capacity(columns.len());
    columns
        .iter()
        .map(|column| {
            if used.insert(column.clone()) {
                return column.clone();
            }

            let mut suffix = 2;
            loop {
                let candidate = format!("{column}_{suffix}");
                if !reserved.contains(&candidate) && used.insert(candidate.clone()) {
                    break candidate;
                }
                suffix += 1;
            }
        })
        .collect()
}

fn write_preamble<W: Write>(writer: &mut W, encoding: CsvEncoding) -> Result<(), ExportError> {
    match encoding {
        CsvEncoding::Utf8 => {}
        CsvEncoding::Utf8Bom => writer.write_all(&[0xef, 0xbb, 0xbf])?,
        CsvEncoding::Utf16Le => writer.write_all(&[0xff, 0xfe])?,
    }
    Ok(())
}

fn write_record<'a, W, I>(
    writer: &mut W,
    values: I,
    delimiter: CsvDelimiter,
    encoding: CsvEncoding,
) -> Result<(), ExportError>
where
    W: Write,
    I: IntoIterator<Item = Option<&'a str>>,
{
    let delimiter = delimiter.as_char();
    let line = values
        .into_iter()
        .map(|value| encode_csv_field(value, delimiter))
        .collect::<Vec<_>>()
        .join(&delimiter.to_string());
    write_text(writer, &line, encoding)?;
    write_text(writer, "\r\n", encoding)?;
    Ok(())
}

fn encode_csv_field(value: Option<&str>, delimiter: char) -> String {
    let value = value.unwrap_or("NULL");
    if value.contains(delimiter)
        || value.contains('"')
        || value.contains('\r')
        || value.contains('\n')
    {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

fn write_text<W: Write>(
    writer: &mut W,
    value: &str,
    encoding: CsvEncoding,
) -> Result<(), io::Error> {
    match encoding {
        CsvEncoding::Utf8 | CsvEncoding::Utf8Bom => writer.write_all(value.as_bytes()),
        CsvEncoding::Utf16Le => {
            for unit in value.encode_utf16() {
                writer.write_all(&unit.to_le_bytes())?;
            }
            Ok(())
        }
    }
}

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("The export request is invalid: {0}")]
    Invalid(String),
    #[error("The export task '{0}' is already running.")]
    AlreadyRunning(String),
    #[error("The export task registry is unavailable.")]
    Lock,
    #[error("The selected export path is invalid: {0}")]
    DialogPath(String),
    #[error("The export file could not be written: {0}")]
    Io(#[from] io::Error),
    #[error("The JSON export could not be serialized: {0}")]
    Json(#[from] serde_json::Error),
    #[error("The completed export could not replace the selected target: {0}")]
    Persist(io::Error),
    #[error("The export progress event could not be sent: {0}")]
    Progress(String),
    #[error("The export worker failed: {0}")]
    Worker(String),
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Write, path::PathBuf, sync::atomic::AtomicBool};

    use super::{
        AtomicExportFile, CancelExportRequest, CancelExportStatus, CsvDelimiter, CsvEncoding,
        CsvExportRequest, CsvWriteOutcome, ExportRegistry, JsonExportRequest, JsonWriteOutcome,
        write_csv, write_json,
    };

    const TASK_ID: &str = "4f9e4878-4e75-4a0e-9f60-08e02f5bd706";

    fn request(encoding: CsvEncoding) -> CsvExportRequest {
        CsvExportRequest {
            task_id: TASK_ID.to_owned(),
            suggested_file_name: "query-result.csv".to_owned(),
            columns: vec!["name".to_owned(), "detail".to_owned()],
            rows: vec![
                vec![Some("alpha,beta".to_owned()), None],
                vec![
                    Some("quoted \"value\"".to_owned()),
                    Some("line\nbreak".to_owned()),
                ],
            ],
            include_headers: true,
            delimiter: CsvDelimiter::Comma,
            encoding,
        }
    }

    #[test]
    fn writes_quoted_csv_with_explicit_nulls_and_a_utf8_bom() {
        let mut bytes = Vec::new();
        let outcome = write_csv(
            &mut bytes,
            &request(CsvEncoding::Utf8Bom),
            &AtomicBool::new(false),
            |_| Ok(()),
        )
        .unwrap();

        assert_eq!(outcome, CsvWriteOutcome::Completed(2));
        assert_eq!(&bytes[..3], &[0xef, 0xbb, 0xbf]);
        assert_eq!(
            String::from_utf8(bytes[3..].to_vec()).unwrap(),
            "name,detail\r\n\"alpha,beta\",NULL\r\n\"quoted \"\"value\"\"\",\"line\nbreak\"\r\n"
        );
    }

    #[test]
    fn writes_utf16_little_endian_output() {
        let mut bytes = Vec::new();
        let mut request = request(CsvEncoding::Utf16Le);
        request.include_headers = false;
        request.rows = vec![vec![
            Some("\u{7fbd}".to_owned()),
            Some("\u{503c}".to_owned()),
        ]];
        write_csv(&mut bytes, &request, &AtomicBool::new(false), |_| Ok(())).unwrap();

        assert_eq!(&bytes[..2], &[0xff, 0xfe]);
        let decoded = String::from_utf16(
            &bytes[2..]
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert_eq!(decoded, "\u{7fbd},\u{503c}\r\n");
    }

    #[test]
    fn honours_cancellation_before_writing_rows() {
        let mut bytes = Vec::new();
        let cancelled = AtomicBool::new(true);
        let outcome = write_csv(&mut bytes, &request(CsvEncoding::Utf8), &cancelled, |_| {
            Ok(())
        })
        .unwrap();

        assert_eq!(outcome, CsvWriteOutcome::Cancelled(0));
        assert!(bytes.is_empty());
    }

    #[test]
    fn registers_cancels_and_finishes_export_tasks() {
        let registry = ExportRegistry::default();
        registry.register(TASK_ID).unwrap();
        assert!(registry.register(TASK_ID).is_err());
        let result = registry
            .cancel(CancelExportRequest {
                task_id: TASK_ID.to_owned(),
            })
            .unwrap();
        assert_eq!(result.status, CancelExportStatus::Requested);

        registry.finish(TASK_ID).unwrap();
        let result = registry
            .cancel(CancelExportRequest {
                task_id: TASK_ID.to_owned(),
            })
            .unwrap();
        assert_eq!(result.status, CancelExportStatus::AlreadyFinished);
    }

    #[test]
    fn rejects_rows_that_do_not_match_the_column_count() {
        let mut request = request(CsvEncoding::Utf8);
        request.rows[0].pop();

        assert!(request.validate().is_err());
    }

    #[test]
    fn writes_json_objects_with_nulls_and_unique_duplicate_column_names() {
        let request = JsonExportRequest {
            task_id: TASK_ID.to_owned(),
            suggested_file_name: "query-result.json".to_owned(),
            columns: vec!["id".to_owned(), "id".to_owned(), "id_2".to_owned()],
            rows: vec![vec![Some("1".to_owned()), None, Some("3".to_owned())]],
        };
        let mut bytes = Vec::new();

        let outcome =
            write_json(&mut bytes, &request, &AtomicBool::new(false), |_| Ok(())).unwrap();

        assert_eq!(outcome, JsonWriteOutcome::Completed(1));
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value[0]["id"], "1");
        assert!(value[0]["id_3"].is_null());
        assert_eq!(value[0]["id_2"], "3");
    }

    #[test]
    fn honours_json_cancellation_before_writing_output() {
        let request = JsonExportRequest {
            task_id: TASK_ID.to_owned(),
            suggested_file_name: "query-result.json".to_owned(),
            columns: vec!["id".to_owned()],
            rows: vec![vec![Some("1".to_owned())]],
        };
        let mut bytes = Vec::new();

        let outcome = write_json(&mut bytes, &request, &AtomicBool::new(true), |_| Ok(())).unwrap();

        assert_eq!(outcome, JsonWriteOutcome::Cancelled(0));
        assert!(bytes.is_empty());
    }

    #[test]
    fn atomically_replaces_an_existing_export_after_commit() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("result.csv");
        fs::write(&target, "previous export").unwrap();
        let mut output = AtomicExportFile::create(target.clone()).unwrap();
        output.file_mut().write_all(b"complete export").unwrap();

        output.commit().unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), "complete export");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn dropping_an_uncommitted_export_preserves_the_target_and_removes_the_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("result.json");
        fs::write(&target, "previous export").unwrap();
        {
            let mut output = AtomicExportFile::create(target.clone()).unwrap();
            output.file_mut().write_all(b"partial export").unwrap();
        }

        assert_eq!(fs::read_to_string(&target).unwrap(), "previous export");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_failed_export_preserves_the_target_and_removes_the_temporary_file() {
        fn fail_after_partial_write(target: PathBuf) -> Result<(), super::ExportError> {
            let mut output = AtomicExportFile::create(target)?;
            output.file_mut().write_all(b"partial export")?;
            Err(super::ExportError::Progress(
                "event channel closed".to_owned(),
            ))
        }

        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("result.csv");
        fs::write(&target, "previous export").unwrap();

        assert!(fail_after_partial_write(target.clone()).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "previous export");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
