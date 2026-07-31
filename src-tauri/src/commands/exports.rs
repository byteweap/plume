use std::{fs::File, io::BufWriter};

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    error::CommandError,
    exports::{
        self, CSV_EXPORT_PROGRESS_EVENT, CancelExportRequest, CancelExportResult, CsvExportRequest,
        CsvExportResult, CsvExportStatus, CsvWriteOutcome, ExportError, ExportRegistry,
        JSON_EXPORT_PROGRESS_EVENT, JsonExportRequest, JsonExportResult, JsonExportStatus,
        JsonWriteOutcome,
    },
};

#[tauri::command]
pub async fn export_csv(
    app: AppHandle,
    exports: State<'_, ExportRegistry>,
    request: CsvExportRequest,
) -> Result<CsvExportResult, CommandError> {
    request.validate().map_err(CommandError::from)?;
    let task_id = request.task_id.clone();
    let cancelled = exports.register(&task_id).map_err(CommandError::from)?;
    let worker_app = app.clone();
    let worker_task_id = task_id.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<CsvExportResult, ExportError> {
            let Some(file_path) = worker_app
                .dialog()
                .file()
                .add_filter("CSV", &["csv"])
                .set_file_name(&request.suggested_file_name)
                .blocking_save_file()
            else {
                return Ok(CsvExportResult {
                    task_id: worker_task_id,
                    status: CsvExportStatus::Dismissed,
                    rows_written: 0,
                });
            };
            let path = file_path
                .into_path()
                .map_err(|error| ExportError::DialogPath(error.to_string()))?;
            let file = File::create(path)?;
            let mut writer = BufWriter::new(file);
            let outcome = exports::write_csv(&mut writer, &request, &cancelled, |progress| {
                worker_app
                    .emit(CSV_EXPORT_PROGRESS_EVENT, progress)
                    .map_err(|error| ExportError::Progress(error.to_string()))
            })?;
            let (status, rows_written) = match outcome {
                CsvWriteOutcome::Completed(rows_written) => {
                    (CsvExportStatus::Completed, rows_written)
                }
                CsvWriteOutcome::Cancelled(rows_written) => {
                    (CsvExportStatus::Cancelled, rows_written)
                }
            };
            Ok(CsvExportResult {
                task_id: worker_task_id,
                status,
                rows_written,
            })
        })
        .await
        .map_err(|error| ExportError::Worker(error.to_string()));
    exports.finish(&task_id).map_err(CommandError::from)?;
    result
        .map_err(CommandError::from)?
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn export_json(
    app: AppHandle,
    exports: State<'_, ExportRegistry>,
    request: JsonExportRequest,
) -> Result<JsonExportResult, CommandError> {
    request.validate().map_err(CommandError::from)?;
    let task_id = request.task_id.clone();
    let cancelled = exports.register(&task_id).map_err(CommandError::from)?;
    let worker_app = app.clone();
    let worker_task_id = task_id.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<JsonExportResult, ExportError> {
            let Some(file_path) = worker_app
                .dialog()
                .file()
                .add_filter("JSON", &["json"])
                .set_file_name(&request.suggested_file_name)
                .blocking_save_file()
            else {
                return Ok(JsonExportResult {
                    task_id: worker_task_id,
                    status: JsonExportStatus::Dismissed,
                    rows_written: 0,
                });
            };
            let path = file_path
                .into_path()
                .map_err(|error| ExportError::DialogPath(error.to_string()))?;
            let file = File::create(path)?;
            let mut writer = BufWriter::new(file);
            let outcome = exports::write_json(&mut writer, &request, &cancelled, |progress| {
                worker_app
                    .emit(JSON_EXPORT_PROGRESS_EVENT, progress)
                    .map_err(|error| ExportError::Progress(error.to_string()))
            })?;
            let (status, rows_written) = match outcome {
                JsonWriteOutcome::Completed(rows_written) => {
                    (JsonExportStatus::Completed, rows_written)
                }
                JsonWriteOutcome::Cancelled(rows_written) => {
                    (JsonExportStatus::Cancelled, rows_written)
                }
            };
            Ok(JsonExportResult {
                task_id: worker_task_id,
                status,
                rows_written,
            })
        })
        .await
        .map_err(|error| ExportError::Worker(error.to_string()));
    exports.finish(&task_id).map_err(CommandError::from)?;
    result
        .map_err(CommandError::from)?
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn cancel_export(
    exports: State<'_, ExportRegistry>,
    request: CancelExportRequest,
) -> Result<CancelExportResult, CommandError> {
    exports.cancel(request).map_err(CommandError::from)
}
